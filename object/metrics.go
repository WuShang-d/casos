package object

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type NodeMetric struct {
	Name       string `json:"name"`
	CPUUsedM   int64  `json:"cpuUsedM"`
	CPUTotalM  int64  `json:"cpuTotalM"`
	MemUsedMi  int64  `json:"memUsedMi"`
	MemTotalMi int64  `json:"memTotalMi"`
}

type PodMetric struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	CPUM      int64  `json:"cpuM"`
	MemMi     int64  `json:"memMi"`
}

type ClusterMetrics struct {
	Nodes []NodeMetric `json:"nodes"`
	Pods  []PodMetric  `json:"pods"`
}

// kubelet /stats/summary JSON types
type kubeletSummary struct {
	Node kubeletNodeStats  `json:"node"`
	Pods []kubeletPodStats `json:"pods"`
}

type kubeletNodeStats struct {
	NodeName string          `json:"nodeName"`
	CPU      *kubeletCPUStat `json:"cpu"`
	Memory   *kubeletMemStat `json:"memory"`
}

type kubeletPodStats struct {
	PodRef     kubeletPodRef           `json:"podRef"`
	Containers []kubeletContainerStats `json:"containers"`
}

type kubeletPodRef struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type kubeletContainerStats struct {
	CPU    *kubeletCPUStat `json:"cpu"`
	Memory *kubeletMemStat `json:"memory"`
}

type kubeletCPUStat struct {
	UsageNanoCores *int64 `json:"usageNanoCores"`
}

type kubeletMemStat struct {
	WorkingSetBytes *int64 `json:"workingSetBytes"`
}

// GetClusterMetrics queries each node's kubelet /stats/summary directly,
// using the apiserver-kubelet-client certificate from certDir.
// This requires no metrics-server installation.
func GetClusterMetrics(cfg *rest.Config, certDir string) (*ClusterMetrics, error) {
	httpClient, err := newKubeletHTTPClient(certDir)
	if err != nil {
		return nil, fmt.Errorf("kubelet http client: %w", err)
	}

	kc, err := newClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("k8s client: %w", err)
	}

	nodes, err := kc.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}

	result := &ClusterMetrics{
		Nodes: []NodeMetric{},
		Pods:  []PodMetric{},
	}

	for _, node := range nodes.Items {
		// Pick the best IP to reach kubelet
		nodeIP := ""
		for _, addr := range node.Status.Addresses {
			if addr.Type == "InternalIP" {
				nodeIP = addr.Address
				break
			}
		}
		if nodeIP == "" {
			continue
		}

		// Node allocatable CPU/memory
		allocCPU := node.Status.Allocatable.Cpu().MilliValue()
		allocMem := node.Status.Allocatable.Memory().Value() / (1024 * 1024)

		summary, err := fetchKubeletSummary(httpClient, nodeIP)
		if err != nil {
			// Node unreachable — include it with zero usage so it still appears
			result.Nodes = append(result.Nodes, NodeMetric{
				Name:       node.Name,
				CPUTotalM:  allocCPU,
				MemTotalMi: allocMem,
			})
			continue
		}

		var cpuM, memMi int64
		if summary.Node.CPU != nil && summary.Node.CPU.UsageNanoCores != nil {
			cpuM = *summary.Node.CPU.UsageNanoCores / 1_000_000
		}
		if summary.Node.Memory != nil && summary.Node.Memory.WorkingSetBytes != nil {
			memMi = *summary.Node.Memory.WorkingSetBytes / (1024 * 1024)
		}

		result.Nodes = append(result.Nodes, NodeMetric{
			Name:       node.Name,
			CPUUsedM:   cpuM,
			CPUTotalM:  allocCPU,
			MemUsedMi:  memMi,
			MemTotalMi: allocMem,
		})

		for _, pod := range summary.Pods {
			var podCPU, podMem int64
			for _, c := range pod.Containers {
				if c.CPU != nil && c.CPU.UsageNanoCores != nil {
					podCPU += *c.CPU.UsageNanoCores / 1_000_000
				}
				if c.Memory != nil && c.Memory.WorkingSetBytes != nil {
					podMem += *c.Memory.WorkingSetBytes / (1024 * 1024)
				}
			}
			result.Pods = append(result.Pods, PodMetric{
				Namespace: pod.PodRef.Namespace,
				Name:      pod.PodRef.Name,
				CPUM:      podCPU,
				MemMi:     podMem,
			})
		}
	}

	return result, nil
}

func fetchKubeletSummary(client *http.Client, nodeIP string) (*kubeletSummary, error) {
	url := fmt.Sprintf("https://%s:10250/stats/summary", nodeIP)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kubelet returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var summary kubeletSummary
	if err := json.Unmarshal(body, &summary); err != nil {
		return nil, err
	}
	return &summary, nil
}

func newKubeletHTTPClient(certDir string) (*http.Client, error) {
	caCert, err := os.ReadFile(filepath.Join(certDir, "ca.crt"))
	if err != nil {
		return nil, fmt.Errorf("read ca.crt: %w", err)
	}
	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM(caCert)

	clientCert, err := tls.LoadX509KeyPair(
		filepath.Join(certDir, "apiserver-kubelet-client.crt"),
		filepath.Join(certDir, "apiserver-kubelet-client.key"),
	)
	if err != nil {
		return nil, fmt.Errorf("load kubelet client cert: %w", err)
	}

	tlsCfg := &tls.Config{
		RootCAs:      caPool,
		Certificates: []tls.Certificate{clientCert},
		// kubelet certificate is signed by cluster CA but SAN is the node hostname,
		// not necessarily the IP we connect to — skip server name verification.
		InsecureSkipVerify: true, // #nosec G402
	}

	return &http.Client{
		Transport: &http.Transport{TLSClientConfig: tlsCfg},
		Timeout:   10 * time.Second,
	}, nil
}
