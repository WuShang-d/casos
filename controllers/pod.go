package controllers

import (
	"encoding/json"
	"sync/atomic"
	"unsafe"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"

	"github.com/casosorg/casos/object"
	"github.com/casosorg/casos/server"
)

// adminCfg is atomically set once the apiserver is ready.
var adminCfg unsafe.Pointer // *rest.Config

// SetAdminRestConfig injects the admin rest config after apiserver bootstrap.
func SetAdminRestConfig(cfg *rest.Config) {
	atomic.StorePointer(&adminCfg, unsafe.Pointer(cfg))
}

func getAdminRestConfig() *rest.Config {
	return (*rest.Config)(atomic.LoadPointer(&adminCfg))
}

// srvCfg is atomically set at startup so controllers can access cert paths.
var srvCfg unsafe.Pointer // *server.Config

// SetServerConfig stores the server.Config for use by node cert generation.
func SetServerConfig(cfg *server.Config) {
	atomic.StorePointer(&srvCfg, unsafe.Pointer(cfg))
}

func getServerConfig() *server.Config {
	return (*server.Config)(atomic.LoadPointer(&srvCfg))
}

type podSummary struct {
	Namespace       string            `json:"namespace"`
	Name            string            `json:"name"`
	Phase           string            `json:"phase"`
	NodeName        string            `json:"nodeName"`
	Image           string            `json:"image"`
	Labels          map[string]string `json:"labels"`
	CreatedAt       string            `json:"createdAt"`
	ResourceVersion string            `json:"resourceVersion"`
}

func toPodSummary(p corev1.Pod) podSummary {
	image := ""
	if len(p.Spec.Containers) > 0 {
		image = p.Spec.Containers[0].Image
	}
	return podSummary{
		Namespace:       p.Namespace,
		Name:            p.Name,
		Phase:           string(p.Status.Phase),
		NodeName:        p.Spec.NodeName,
		Image:           image,
		Labels:          p.Labels,
		CreatedAt:       p.CreationTimestamp.UTC().Format("2006-01-02 15:04:05"),
		ResourceVersion: p.ResourceVersion,
	}
}

// GetPods
// @router /api/get-pods [get]
func (c *ApiController) GetPods() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	pods, err := object.GetPods(cfg, namespace)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	result := make([]podSummary, 0, len(pods))
	for _, p := range pods {
		result = append(result, toPodSummary(p))
	}
	c.ResponseOk(result)
}

// GetPod
// @router /api/get-pod [get]
func (c *ApiController) GetPod() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	name := c.GetString("name")
	pod, err := object.GetPod(cfg, namespace, name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toPodSummary(*pod))
}

type podRequest struct {
	Namespace       string            `json:"namespace"`
	Name            string            `json:"name"`
	Image           string            `json:"image"`
	ContainerName   string            `json:"containerName"`
	Labels          map[string]string `json:"labels"`
	ResourceVersion string            `json:"resourceVersion"`
}

// AddPod
// @router /api/add-pod [post]
func (c *ApiController) AddPod() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req podRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	if req.ContainerName == "" {
		req.ContainerName = "app"
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      req.Name,
			Namespace: req.Namespace,
			Labels:    req.Labels,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: req.ContainerName, Image: req.Image},
			},
		},
	}
	created, err := object.AddPod(cfg, pod)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toPodSummary(*created))
}

// UpdatePod updates pod labels only (pod spec is immutable after creation).
// @router /api/update-pod [post]
func (c *ApiController) UpdatePod() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req podRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	// Fetch current pod to preserve immutable spec.
	existing, err := object.GetPod(cfg, req.Namespace, req.Name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	existing.Labels = req.Labels
	existing.ResourceVersion = req.ResourceVersion
	updated, err := object.UpdatePod(cfg, existing)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toPodSummary(*updated))
}

// DeletePod
// @router /api/delete-pod [post]
func (c *ApiController) DeletePod() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req podRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	if err := object.DeletePod(cfg, req.Namespace, req.Name); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}
