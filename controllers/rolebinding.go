package controllers

import (
	"encoding/json"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/casosorg/casos/object"
)

type roleBindingSummary struct {
	Namespace       string           `json:"namespace"`
	Name            string           `json:"name"`
	RoleRef         string           `json:"roleRef"`
	RoleRefKind     string           `json:"roleRefKind"`
	Subjects        []subjectSummary `json:"subjects"`
	CreatedAt       string           `json:"createdAt"`
	ResourceVersion string           `json:"resourceVersion"`
}

func toRbSummary(rb rbacv1.RoleBinding) roleBindingSummary {
	subjects := make([]subjectSummary, 0, len(rb.Subjects))
	for _, s := range rb.Subjects {
		subjects = append(subjects, subjectSummary{
			Kind:      s.Kind,
			Name:      s.Name,
			Namespace: s.Namespace,
		})
	}
	return roleBindingSummary{
		Namespace:       rb.Namespace,
		Name:            rb.Name,
		RoleRef:         rb.RoleRef.Name,
		RoleRefKind:     rb.RoleRef.Kind,
		Subjects:        subjects,
		CreatedAt:       rb.CreationTimestamp.UTC().Format("2006-01-02 15:04:05"),
		ResourceVersion: rb.ResourceVersion,
	}
}

// GetRoleBindings
// @router /api/get-rolebindings [get]
func (c *ApiController) GetRoleBindings() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	rbs, err := object.GetRoleBindings(cfg, namespace)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	result := make([]roleBindingSummary, 0, len(rbs))
	for _, rb := range rbs {
		result = append(result, toRbSummary(rb))
	}
	c.ResponseOk(result)
}

// GetRoleBinding
// @router /api/get-rolebinding [get]
func (c *ApiController) GetRoleBinding() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	name := c.GetString("name")
	rb, err := object.GetRoleBinding(cfg, namespace, name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toRbSummary(*rb))
}

type roleBindingRequest struct {
	Namespace       string           `json:"namespace"`
	Name            string           `json:"name"`
	RoleRef         string           `json:"roleRef"`
	RoleRefKind     string           `json:"roleRefKind"`
	Subjects        []subjectRequest `json:"subjects"`
	ResourceVersion string           `json:"resourceVersion"`
}

func buildRb(req roleBindingRequest) *rbacv1.RoleBinding {
	roleRefKind := req.RoleRefKind
	if roleRefKind == "" {
		roleRefKind = "Role"
	}
	subjects := make([]rbacv1.Subject, 0, len(req.Subjects))
	for _, s := range req.Subjects {
		subj := rbacv1.Subject{
			Kind: s.Kind,
			Name: s.Name,
		}
		if s.Kind == "ServiceAccount" {
			subj.Namespace = s.Namespace
		}
		subjects = append(subjects, subj)
	}
	return &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: req.Namespace,
			Name:      req.Name,
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     roleRefKind,
			Name:     req.RoleRef,
		},
		Subjects: subjects,
	}
}

// AddRoleBinding
// @router /api/add-rolebinding [post]
func (c *ApiController) AddRoleBinding() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req roleBindingRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	rb := buildRb(req)
	created, err := object.AddRoleBinding(cfg, rb)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toRbSummary(*created))
}

// UpdateRoleBinding replaces subjects; roleRef is immutable after creation.
// @router /api/update-rolebinding [post]
func (c *ApiController) UpdateRoleBinding() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req roleBindingRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	existing, err := object.GetRoleBinding(cfg, req.Namespace, req.Name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	subjects := make([]rbacv1.Subject, 0, len(req.Subjects))
	for _, s := range req.Subjects {
		subj := rbacv1.Subject{Kind: s.Kind, Name: s.Name}
		if s.Kind == "ServiceAccount" {
			subj.Namespace = s.Namespace
		}
		subjects = append(subjects, subj)
	}
	existing.Subjects = subjects
	existing.ResourceVersion = req.ResourceVersion
	updated, err := object.UpdateRoleBinding(cfg, existing)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toRbSummary(*updated))
}

// DeleteRoleBinding
// @router /api/delete-rolebinding [post]
func (c *ApiController) DeleteRoleBinding() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req roleBindingRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if err := object.DeleteRoleBinding(cfg, req.Namespace, req.Name); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}
