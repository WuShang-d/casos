package controllers

import (
	"encoding/json"

	"github.com/casosorg/casos/deploy"
	"github.com/casosorg/casos/object"
	"github.com/casosorg/casos/server"
	corev1 "k8s.io/api/core/v1"
)

type nodeSummary struct {
	Name            string            `json:"name"`
	Status          string            `json:"status"`
	StatusReason    string            `json:"statusReason"`
	StatusMessage   string            `json:"statusMessage"`
	LastHeartbeat   string            `json:"lastHeartbeat"`
	Roles           []string          `json:"roles"`
	Labels          map[string]string `json:"labels"`
	Unschedulable   bool              `json:"unschedulable"`
	Taints          []string          `json:"taints"`
	KubeletVersion  string            `json:"kubeletVersion"`
	OS              string            `json:"os"`
	Arch            string            `json:"arch"`
	InternalIP      string            `json:"internalIP"`
	ExternalIP      string            `json:"externalIP"`
	CreatedAt       string            `json:"createdAt"`
	ResourceVersion string            `json:"resourceVersion"`

	// AdmissionDenials is filled in only when CasOS's own webhook is rejecting
	// this node's kubelet. The Node object cannot carry that: a kubelet being
	// denied and a kubelet that died look identical from the API's side.
	AdmissionDenials []server.AdmissionDenial `json:"admissionDenials,omitempty"`

	Allocation *nodeAllocation `json:"allocation,omitempty"`
}

// maxNodeDenials bounds what one node contributes to the page. A kubelet locked
// out by policy is denied on a handful of resources; past that the list stops
// being a diagnosis and starts being a log.
const maxNodeDenials = 6

// attachAdmissionDenials joins the webhook's denial log onto a node that is not
// Ready, so the page names the actual rejected requests instead of sending the
// operator to the kubelet log on the node.
func attachAdmissionDenials(s *nodeSummary) {
	if s.Status == "Ready" {
		return
	}
	found := server.AdmissionDenialsFor("system:node:" + s.Name)
	if len(found) > maxNodeDenials {
		found = found[:maxNodeDenials]
	}
	if len(found) > 0 {
		s.AdmissionDenials = found
	}
}

func toNodeSummary(n corev1.Node) nodeSummary {
	// kubectl prints NotReady for both False and Unknown, so the badge matches
	// what an operator sees from the CLI. The reason and message are what tells
	// them apart, so carry those through instead of dropping them here.
	status := "Unknown"
	statusReason, statusMessage, lastHeartbeat := "", "", ""
	readyFound := false
	for _, c := range n.Status.Conditions {
		if c.Type != corev1.NodeReady {
			continue
		}
		readyFound = true
		if c.Status == corev1.ConditionTrue {
			status = "Ready"
		} else {
			status = "NotReady"
			// On a healthy node kubelet leaves "KubeletReady" here, which is
			// noise; only an unhealthy node has a reason worth showing.
			statusReason = c.Reason
			statusMessage = c.Message
		}
		if !c.LastHeartbeatTime.IsZero() {
			lastHeartbeat = c.LastHeartbeatTime.UTC().Format("2006-01-02 15:04:05")
		}
	}
	if !readyFound {
		statusReason = "NoReadyCondition"
		statusMessage = "The node object exists but kubelet has never reported a Ready condition for it."
	}
	roles := []string{}
	for k := range n.Labels {
		if k == "node-role.kubernetes.io/control-plane" {
			roles = append(roles, "control-plane")
		} else if k == "node-role.kubernetes.io/worker" {
			roles = append(roles, "worker")
		}
	}
	if len(roles) == 0 {
		roles = append(roles, "worker")
	}
	var internalIP, externalIP string
	for _, addr := range n.Status.Addresses {
		switch addr.Type {
		case corev1.NodeInternalIP:
			internalIP = addr.Address
		case corev1.NodeExternalIP:
			externalIP = addr.Address
		}
	}

	return nodeSummary{
		Name:            n.Name,
		Status:          status,
		StatusReason:    statusReason,
		StatusMessage:   statusMessage,
		LastHeartbeat:   lastHeartbeat,
		Roles:           roles,
		Labels:          n.Labels,
		Unschedulable:   n.Spec.Unschedulable,
		Taints:          nodeTaints(n),
		KubeletVersion:  n.Status.NodeInfo.KubeletVersion,
		OS:              n.Status.NodeInfo.OperatingSystem,
		Arch:            n.Status.NodeInfo.Architecture,
		InternalIP:      internalIP,
		ExternalIP:      externalIP,
		CreatedAt:       n.CreationTimestamp.UTC().Format("2006-01-02 15:04:05"),
		ResourceVersion: n.ResourceVersion,
	}
}

// GetNodes lists all nodes.
// @router /api/get-nodes [get]
func (c *ApiController) GetNodes() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	nodes, err := object.GetNodes(cfg)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	// Allocation is best-effort: a failed pod list must not hide the nodes.
	var podsByNode map[string][]*corev1.Pod
	if pods, err := object.GetPods(cfg, ""); err == nil {
		podsByNode = groupPodsByNode(pods)
	}
	result := make([]nodeSummary, 0, len(nodes))
	for _, n := range nodes {
		summary := toNodeSummary(n)
		attachAdmissionDenials(&summary)
		if podsByNode != nil {
			summary.Allocation = nodeAllocationOf(n, podsByNode[n.Name])
		}
		result = append(result, summary)
	}
	c.ResponseOk(result)
}

// GetNode returns a single node.
// @router /api/get-node [get]
func (c *ApiController) GetNode() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	name := c.GetString("name")
	node, err := object.GetNode(cfg, name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	summary := toNodeSummary(*node)
	attachAdmissionDenials(&summary)
	c.ResponseOk(summary)
}

type nodeRequest struct {
	Name            string            `json:"name"`
	Labels          map[string]string `json:"labels"`
	Unschedulable   bool              `json:"unschedulable"`
	ResourceVersion string            `json:"resourceVersion"`
}

// UpdateNode updates a node's labels and schedulability.
// @router /api/update-node [post]
func (c *ApiController) UpdateNode() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req nodeRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	existing, err := object.GetNode(cfg, req.Name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	existing.Labels = req.Labels
	existing.Spec.Unschedulable = req.Unschedulable
	existing.ResourceVersion = req.ResourceVersion
	updated, err := object.UpdateNode(cfg, existing)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toNodeSummary(*updated))
}

// DeleteNode removes a node from the cluster (does not stop kubelet).
// @router /api/delete-node [post]
func (c *ApiController) DeleteNode() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req nodeRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if err := object.DeleteNode(cfg, req.Name); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}

// GetWorkerKubeconfig generates a signed node client certificate and returns a
// ready-to-use kubeconfig for kubelet. This is an operational helper, not a
// Node CRUD operation.
// @router /api/get-worker-kubeconfig [get]
func (c *ApiController) GetWorkerKubeconfig() {
	nodeName := c.GetString("nodeName")
	if nodeName == "" {
		nodeName = "wsl2-worker"
	}
	cfg := getServerConfig()
	if cfg == nil {
		c.ResponseError("server config not ready")
		return
	}
	wk, err := server.GenerateWorkerKubeconfig(*cfg, nodeName)
	if err != nil {
		c.ResponseError("generate worker kubeconfig: " + err.Error())
		return
	}
	resp := map[string]string{
		"nodeName":             wk.NodeName,
		"kubeconfig":           wk.Kubeconfig,
		"containerdConfig":     deploy.GenerateContainerdConfig(cfg.SandboxImage),
		"imageRegistryMirror":  string(cfg.RegistryMirrorMode),
		"dockerHubHostsToml":   deploy.GenerateDockerHubHostsToml(),
		"k8sRegistryHostsToml": deploy.GenerateK8sRegistryHostsToml(),
	}
	c.ResponseOk(resp)
}
