package controllers

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/casosorg/casos/deploy"
	"github.com/casosorg/casos/object"
	"github.com/casosorg/casos/server"
)

// The app gateway.
//
// An app installed on a desktop machine has an Ingress host such as
// ai-x1y2z3.localhost, which every browser resolves to the machine itself — but
// on Windows nothing on the machine answers port 80: the ingress controller
// runs inside WSL, behind WSL's own address. So casos answers for *.localhost
// on its own port and hands the request, Host header and all, to the ingress
// controller.

const appGatewayTargetTTL = 15 * time.Second

var appGatewayTarget struct {
	mu      sync.Mutex
	url     *url.URL
	fetched time.Time
}

func isAppGatewayDomain(domain string) bool {
	return domain == "localhost" || strings.HasSuffix(domain, ".localhost")
}

// IsAppGatewayHost reports whether a request is for an app rather than for
// casos itself: a name under localhost, not localhost.
func IsAppGatewayHost(host string) bool {
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	return strings.HasSuffix(strings.ToLower(host), ".localhost")
}

// AppGatewayTarget is where the ingress controller answers. Its load balancer
// address comes first, because that one is reachable from wherever casos runs;
// the ClusterIP is reachable only through routes into the cluster network.
func AppGatewayTarget() (*url.URL, error) {
	appGatewayTarget.mu.Lock()
	defer appGatewayTarget.mu.Unlock()
	if appGatewayTarget.url != nil && time.Since(appGatewayTarget.fetched) < appGatewayTargetTTL {
		return appGatewayTarget.url, nil
	}

	cfg := getAdminRestConfig()
	if cfg == nil {
		return nil, fmt.Errorf("apiserver not ready")
	}
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	namespace, name := server.IngressControllerService()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	service, err := client.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("ingress controller: %w", err)
	}

	port := int32(80)
	for _, servicePort := range service.Spec.Ports {
		if servicePort.Name == "web" {
			port = servicePort.Port
		}
	}
	host := service.Spec.ClusterIP
	for _, ingress := range service.Status.LoadBalancer.Ingress {
		if ingress.IP != "" {
			host = ingress.IP
			break
		}
	}
	if host == "" || host == corev1.ClusterIPNone {
		return nil, fmt.Errorf("the ingress controller has no address yet")
	}

	target := &url.URL{Scheme: "http", Host: net.JoinHostPort(host, strconv.Itoa(int(port)))}
	appGatewayTarget.url = target
	appGatewayTarget.fetched = time.Now()
	return target, nil
}

type gpuSummary struct {
	Name      string
	MemoryMiB int
}

// clusterGPU names the largest GPU on a Ready node, as the node deployment
// labelled it.
func clusterGPU(cfg *rest.Config) gpuSummary {
	best := gpuSummary{}
	if cfg == nil {
		return best
	}
	nodes, err := object.GetNodes(cfg)
	if err != nil {
		return best
	}
	for _, node := range nodes {
		if node.Labels[deploy.NvidiaGPUPresentLabel] != "true" || !nodeIsReady(node) {
			continue
		}
		memory, _ := strconv.Atoi(node.Labels[deploy.NvidiaGPUMemoryLabel])
		if best.Name != "" && memory <= best.MemoryMiB {
			continue
		}
		best = gpuSummary{
			Name:      strings.ReplaceAll(node.Labels["nvidia.com/gpu.product"], "-", " "),
			MemoryMiB: memory,
		}
	}
	return best
}

func nodeIsReady(node corev1.Node) bool {
	for _, condition := range node.Status.Conditions {
		if condition.Type == corev1.NodeReady {
			return condition.Status == corev1.ConditionTrue
		}
	}
	return false
}
