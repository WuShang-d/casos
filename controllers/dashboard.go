package controllers

import (
	corev1 "k8s.io/api/core/v1"

	"github.com/casosorg/casos/object"
)

type dashboardStats struct {
	NodesTotal      int            `json:"nodesTotal"`
	NodesReady      int            `json:"nodesReady"`
	NodesByOS       map[string]int `json:"nodesByOS"`
	NodesByArch     map[string]int `json:"nodesByArch"`
	PodsTotal       int            `json:"podsTotal"`
	PodsRunning     int            `json:"podsRunning"`
	PodsByPhase     map[string]int `json:"podsByPhase"`
	PodsByNamespace map[string]int `json:"podsByNamespace"`
	NamespacesTotal int            `json:"namespacesTotal"`
	ServicesTotal   int            `json:"servicesTotal"`
	ServicesByType  map[string]int `json:"servicesByType"`
	ConfigMapsTotal int            `json:"configMapsTotal"`
	ServiceAccounts int            `json:"serviceAccounts"`
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

	if configMaps, err := object.GetConfigMaps(cfg, ""); err == nil {
		stats.ConfigMapsTotal = len(configMaps)
	}

	if sas, err := object.GetServiceAccounts(cfg, ""); err == nil {
		stats.ServiceAccounts = len(sas)
	}

	c.ResponseOk(stats)
}
