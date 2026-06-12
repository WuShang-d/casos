package controllers

import (
	"github.com/beego/beego/v2/server/web"
	"github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// adminToken is injected at startup after the apiserver bootstrap completes.
// TODO: read from DataDir service-account token in milestone 2.
var adminToken = ""

// SetAdminToken lets main.go inject the bearer token after apiserver is ready.
func SetAdminToken(token string) { adminToken = token }

// PodController serves GET /api/pods.
type PodController struct {
	web.Controller
}

type podSummary struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Phase     string `json:"phase"`
	NodeName  string `json:"nodeName"`
}

func (c *PodController) GetAll() {
	cfg := &rest.Config{
		Host: "https://127.0.0.1:6443",
		// Milestone 1: skip TLS verification against the self-signed cert.
		// Milestone 2: set CAFile to the generated ca.crt instead.
		TLSClientConfig: rest.TLSClientConfig{Insecure: true},
		BearerToken:     adminToken,
	}
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		logrus.Errorf("pod controller: build k8s client: %v", err)
		c.Ctx.Output.SetStatus(500)
		c.Data["json"] = map[string]string{"error": err.Error()}
		c.ServeJSON()
		return
	}

	pods, err := client.CoreV1().Pods("").List(c.Ctx.Request.Context(), metav1.ListOptions{})
	if err != nil {
		logrus.Errorf("pod controller: list pods: %v", err)
		c.Ctx.Output.SetStatus(502)
		c.Data["json"] = map[string]string{"error": err.Error()}
		c.ServeJSON()
		return
	}

	result := make([]podSummary, 0, len(pods.Items))
	for _, p := range pods.Items {
		result = append(result, podSummary{
			Namespace: p.Namespace,
			Name:      p.Name,
			Phase:     string(p.Status.Phase),
			NodeName:  p.Spec.NodeName,
		})
	}
	c.Data["json"] = result
	c.ServeJSON()
}
