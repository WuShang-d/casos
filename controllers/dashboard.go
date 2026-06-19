package controllers

import (
	"path/filepath"

	corev1 "k8s.io/api/core/v1"

	"github.com/casosorg/casos/object"
)

type unhealthyPod struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Phase     string `json:"phase"`
	Reason    string `json:"reason"`
}

type dashboardStats struct {
	NodesTotal           int            `json:"nodesTotal"`
	NodesReady           int            `json:"nodesReady"`
	NodesByOS            map[string]int `json:"nodesByOS"`
	NodesByArch          map[string]int `json:"nodesByArch"`
	PodsTotal            int            `json:"podsTotal"`
	PodsRunning          int            `json:"podsRunning"`
	PodsByPhase          map[string]int `json:"podsByPhase"`
	PodsByNamespace      map[string]int `json:"podsByNamespace"`
	NamespacesTotal      int            `json:"namespacesTotal"`
	ServicesTotal        int            `json:"servicesTotal"`
	ServicesByType       map[string]int `json:"servicesByType"`
	ConfigMapsTotal      int            `json:"configMapsTotal"`
	ServiceAccounts      int            `json:"serviceAccounts"`
	DeploymentsTotal     int            `json:"deploymentsTotal"`
	DeploymentsAvailable int            `json:"deploymentsAvailable"`
	UnhealthyPods        []unhealthyPod `json:"unhealthyPods"`
	// Resource usage (from metrics-server; zero when metrics-server is absent)
	ClusterCPUUsedM   int64 `json:"clusterCPUUsedM"`
	ClusterCPUTotalM  int64 `json:"clusterCPUTotalM"`
	ClusterMemUsedMi  int64 `json:"clusterMemUsedMi"`
	ClusterMemTotalMi int64 `json:"clusterMemTotalMi"`
}

// GetDashboard returns aggregated cluster statistics.
// @router /api/get-dashboard [get]
func (c *ApiController) GetDashboard() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}

	stats := dashboardStats{
		NodesByOS:       map[string]int{},
		NodesByArch:     map[string]int{},
		PodsByPhase:     map[string]int{},
		PodsByNamespace: map[string]int{},
		ServicesByType:  map[string]int{},
		UnhealthyPods:   []unhealthyPod{},
	}

	if nodes, err := object.GetNodes(cfg); err == nil {
		stats.NodesTotal = len(nodes)
		for _, n := range nodes {
			for _, cond := range n.Status.Conditions {
				if cond.Type == corev1.NodeReady && cond.Status == corev1.ConditionTrue {
					stats.NodesReady++
				}
			}
			os := n.Status.NodeInfo.OperatingSystem
			if os == "" {
				os = "unknown"
			}
			stats.NodesByOS[os]++
			arch := n.Status.NodeInfo.Architecture
			if arch == "" {
				arch = "unknown"
			}
			stats.NodesByArch[arch]++
		}
	}

	unhealthyReasons := map[string]bool{
		"CrashLoopBackOff":           true,
		"OOMKilled":                  true,
		"ImagePullBackOff":           true,
		"ErrImagePull":               true,
		"InvalidImageName":           true,
		"CreateContainerConfigError": true,
		"CreateContainerError":       true,
		"Evicted":                    true,
	}

	if pods, err := object.GetPods(cfg, ""); err == nil {
		stats.PodsTotal = len(pods)
		for _, p := range pods {
			phase := string(p.Status.Phase)
			if phase == "" {
				phase = "Unknown"
			}
			stats.PodsByPhase[phase]++
			if phase == "Running" {
				stats.PodsRunning++
			}
			ns := p.Namespace
			if ns == "" {
				ns = "default"
			}
			stats.PodsByNamespace[ns]++

			// Detect unhealthy pods
			reason := ""
			if phase == "Failed" {
				reason = p.Status.Reason
				if reason == "" {
					reason = "Failed"
				}
			} else if phase == "Unknown" {
				reason = "Unknown"
			} else {
				// Check container statuses for known bad waiting/terminated reasons
			outer:
				for _, cs := range p.Status.ContainerStatuses {
					if cs.State.Waiting != nil && unhealthyReasons[cs.State.Waiting.Reason] {
						reason = cs.State.Waiting.Reason
						break outer
					}
					if cs.State.Terminated != nil && unhealthyReasons[cs.State.Terminated.Reason] {
						reason = cs.State.Terminated.Reason
						break outer
					}
				}
				for _, cs := range p.Status.InitContainerStatuses {
					if reason != "" {
						break
					}
					if cs.State.Waiting != nil && unhealthyReasons[cs.State.Waiting.Reason] {
						reason = cs.State.Waiting.Reason
					}
				}
			}
			if reason != "" {
				stats.UnhealthyPods = append(stats.UnhealthyPods, unhealthyPod{
					Namespace: ns,
					Name:      p.Name,
					Phase:     phase,
					Reason:    reason,
				})
			}
		}
	}

	if namespaces, err := object.GetNamespaces(cfg); err == nil {
		stats.NamespacesTotal = len(namespaces)
	}

	if services, err := object.GetServices(cfg, ""); err == nil {
		stats.ServicesTotal = len(services)
		for _, svc := range services {
			t := string(svc.Spec.Type)
			if t == "" {
				t = "ClusterIP"
			}
			stats.ServicesByType[t]++
		}
	}

	if deployments, err := object.GetDeployments(cfg, ""); err == nil {
		stats.DeploymentsTotal = len(deployments)
		for _, d := range deployments {
			desired := int32(1)
			if d.Spec.Replicas != nil {
				desired = *d.Spec.Replicas
			}
			if d.Status.AvailableReplicas >= desired {
				stats.DeploymentsAvailable++
			}
		}
	}

	if configMaps, err := object.GetConfigMaps(cfg, ""); err == nil {
		stats.ConfigMapsTotal = len(configMaps)
	}

	if sas, err := object.GetServiceAccounts(cfg, ""); err == nil {
		stats.ServiceAccounts = len(sas)
	}

	// Cluster resource usage — best-effort, ignored if kubelet is unreachable
	certDir := ""
	if sc := getServerConfig(); sc != nil {
		certDir = filepath.Join(sc.DataDir, "tls")
	}
	if clusterMetrics, err := object.GetClusterMetrics(cfg, certDir); err == nil {
		for _, nm := range clusterMetrics.Nodes {
			stats.ClusterCPUUsedM += nm.CPUUsedM
			stats.ClusterCPUTotalM += nm.CPUTotalM
			stats.ClusterMemUsedMi += nm.MemUsedMi
			stats.ClusterMemTotalMi += nm.MemTotalMi
		}
	}

	c.ResponseOk(stats)
}
