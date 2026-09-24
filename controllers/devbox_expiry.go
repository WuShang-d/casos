package controllers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/beego/beego/logs"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"

	"github.com/casosorg/casos/object"
)

// A sandbox is a DevBox an AI agent created over MCP. It carries a lease, and
// is deleted together with its home disk once the lease runs out, so an agent
// that forgets to clean up does not leave workspaces running for ever.

const (
	devboxExpiresAnnotation = "casos.io/devbox-expires-at"
	devboxAgentAnnotation   = "casos.io/devbox-agent"

	devboxReapInterval = time.Minute
)

func applyDevboxLease(meta *metav1.ObjectMeta, expiresAt time.Time, agent string) {
	if !expiresAt.IsZero() {
		applyAnnotation(meta, devboxExpiresAnnotation, expiresAt.UTC().Format(time.RFC3339))
	}
	if agent != "" {
		applyAnnotation(meta, devboxAgentAnnotation, agent)
	}
}

func devboxExpiry(meta metav1.ObjectMeta) (time.Time, bool) {
	value := meta.Annotations[devboxExpiresAnnotation]
	if value == "" {
		return time.Time{}, false
	}
	expiresAt, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, false
	}
	return expiresAt, true
}

// setDevboxExpiry moves a box's lease; a zero time removes it, keeping the box.
func setDevboxExpiry(cfg *rest.Config, namespace, name string, expiresAt time.Time) error {
	depl, err := object.GetDeployment(cfg, namespace, name)
	if err != nil {
		return err
	}
	if depl.Labels[devboxLabel] != "true" {
		return fmt.Errorf("%s is not a DevBox", name)
	}
	if expiresAt.IsZero() {
		delete(depl.Annotations, devboxExpiresAnnotation)
	} else {
		applyAnnotation(&depl.ObjectMeta, devboxExpiresAnnotation, expiresAt.UTC().Format(time.RFC3339))
	}
	_, err = object.UpdateDeployment(cfg, depl)
	return err
}

// StartDevboxReaper deletes sandboxes whose lease has run out, until ctx ends.
func StartDevboxReaper(ctx context.Context) {
	ticker := time.NewTicker(devboxReapInterval)
	defer ticker.Stop()
	for {
		reapExpiredDevboxes()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func reapExpiredDevboxes() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		return
	}
	deployments, err := object.GetDeployments(cfg, "")
	if err != nil {
		logs.Warning("devbox reaper: list deployments: %v", err)
		return
	}
	now := time.Now()
	for _, d := range deployments {
		if d.Labels[devboxLabel] != "true" {
			continue
		}
		expiresAt, ok := devboxExpiry(d.ObjectMeta)
		if !ok || now.Before(expiresAt) {
			continue
		}
		if err := uninstallImageApp(cfg, d.Namespace, d.Name, true); err != nil {
			logs.Warning("devbox reaper: delete expired sandbox %s/%s: %v", d.Namespace, d.Name, err)
			continue
		}
		logs.Info("devbox reaper: deleted sandbox %s/%s, whose lease ran out at %s", d.Namespace, d.Name, expiresAt.Format(time.RFC3339))
	}
}

type keepDevboxRequest struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// KeepDevbox removes a sandbox's lease, so a person can take over what an
// agent started without it being deleted underneath them.
// @router /api/keep-devbox [post]
func (c *ApiController) KeepDevbox() {
	if c.RequireAdmin() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req keepDevboxRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	if err := setDevboxExpiry(cfg, req.Namespace, req.Name, time.Time{}); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}
