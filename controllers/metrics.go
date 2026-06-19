package controllers

import (
	"path/filepath"

	"github.com/casosorg/casos/object"
)

// GetMetrics returns node and pod resource usage by querying each node's
// kubelet /stats/summary directly — no metrics-server required.
// @router /api/get-metrics [get]
func (c *ApiController) GetMetrics() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	srvCfg := getServerConfig()
	if srvCfg == nil {
		c.ResponseError("server config not ready")
		return
	}
	certDir := filepath.Join(srvCfg.DataDir, "tls")

	metrics, err := object.GetClusterMetrics(cfg, certDir)
	if err != nil {
		c.ResponseOk(object.ClusterMetrics{Nodes: []object.NodeMetric{}, Pods: []object.PodMetric{}})
		return
	}
	c.ResponseOk(metrics)
}
