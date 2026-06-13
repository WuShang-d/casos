package controllers

import (
	"encoding/json"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/casosorg/casos/object"
)

type namespaceSummary struct {
	Name            string `json:"name"`
	Status          string `json:"status"`
	CreatedAt       string `json:"createdAt"`
	ResourceVersion string `json:"resourceVersion"`
}

func toNsSummary(ns corev1.Namespace) namespaceSummary {
	return namespaceSummary{
		Name:            ns.Name,
		Status:          string(ns.Status.Phase),
		CreatedAt:       ns.CreationTimestamp.UTC().Format("2006-01-02 15:04:05"),
		ResourceVersion: ns.ResourceVersion,
	}
}

// GetNamespaces
// @router /api/get-namespaces [get]
func (c *ApiController) GetNamespaces() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	nsList, err := object.GetNamespaces(cfg)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	result := make([]namespaceSummary, 0, len(nsList))
	for _, ns := range nsList {
		result = append(result, toNsSummary(ns))
	}
	c.ResponseOk(result)
}

// GetNamespace
// @router /api/get-namespace [get]
func (c *ApiController) GetNamespace() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	name := c.GetString("name")
	ns, err := object.GetNamespace(cfg, name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toNsSummary(*ns))
}

type namespaceRequest struct {
	Name            string `json:"name"`
	ResourceVersion string `json:"resourceVersion"`
}

// AddNamespace
// @router /api/add-namespace [post]
func (c *ApiController) AddNamespace() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req namespaceRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name},
	}
	created, err := object.AddNamespace(cfg, ns)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toNsSummary(*created))
}

// UpdateNamespace — Namespaces have no user-editable spec; this is a no-op placeholder
// kept for API symmetry. Returns current state.
// @router /api/update-namespace [post]
func (c *ApiController) UpdateNamespace() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req namespaceRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	ns, err := object.GetNamespace(cfg, req.Name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	// Labels/annotations could be updated here in the future.
	updated, err := object.UpdateNamespace(cfg, ns)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toNsSummary(*updated))
}

// DeleteNamespace
// @router /api/delete-namespace [post]
func (c *ApiController) DeleteNamespace() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req namespaceRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if err := object.DeleteNamespace(cfg, req.Name); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}
