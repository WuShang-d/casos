package controllers

import (
	"encoding/json"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/casosorg/casos/object"
)

type secretSummary struct {
	Namespace       string            `json:"namespace"`
	Name            string            `json:"name"`
	Type            string            `json:"type"`
	DataKeys        int               `json:"dataKeys"`
	StringData      map[string]string `json:"stringData"`
	CreatedAt       string            `json:"createdAt"`
	ResourceVersion string            `json:"resourceVersion"`
}

func toSecretSummary(s corev1.Secret) secretSummary {
	sd := make(map[string]string, len(s.Data))
	for k, v := range s.Data {
		sd[k] = string(v)
	}
	return secretSummary{
		Namespace:       s.Namespace,
		Name:            s.Name,
		Type:            string(s.Type),
		DataKeys:        len(s.Data),
		StringData:      sd,
		CreatedAt:       s.CreationTimestamp.UTC().Format("2006-01-02 15:04:05"),
		ResourceVersion: s.ResourceVersion,
	}
}

// GetSecrets
// @router /api/get-secrets [get]
func (c *ApiController) GetSecrets() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	secrets, err := object.GetSecrets(cfg, namespace)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	result := make([]secretSummary, 0, len(secrets))
	for _, s := range secrets {
		result = append(result, toSecretSummary(s))
	}
	c.ResponseOk(result)
}

// GetSecret
// @router /api/get-secret [get]
func (c *ApiController) GetSecret() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	name := c.GetString("name")
	s, err := object.GetSecret(cfg, namespace, name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toSecretSummary(*s))
}

type secretRequest struct {
	Namespace       string            `json:"namespace"`
	Name            string            `json:"name"`
	Type            string            `json:"type"`
	StringData      map[string]string `json:"stringData"`
	ResourceVersion string            `json:"resourceVersion"`
}

// AddSecret
// @router /api/add-secret [post]
func (c *ApiController) AddSecret() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req secretRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	secretType := corev1.SecretTypeOpaque
	if req.Type != "" {
		secretType = corev1.SecretType(req.Type)
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      req.Name,
			Namespace: req.Namespace,
		},
		Type:       secretType,
		StringData: req.StringData,
	}
	created, err := object.AddSecret(cfg, secret)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toSecretSummary(*created))
}

// UpdateSecret
// @router /api/update-secret [post]
func (c *ApiController) UpdateSecret() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req secretRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	secretType := corev1.SecretTypeOpaque
	if req.Type != "" {
		secretType = corev1.SecretType(req.Type)
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            req.Name,
			Namespace:       req.Namespace,
			ResourceVersion: req.ResourceVersion,
		},
		Type:       secretType,
		StringData: req.StringData,
	}
	updated, err := object.UpdateSecret(cfg, secret)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toSecretSummary(*updated))
}

// DeleteSecret
// @router /api/delete-secret [post]
func (c *ApiController) DeleteSecret() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req secretRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	if err := object.DeleteSecret(cfg, req.Namespace, req.Name); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}
