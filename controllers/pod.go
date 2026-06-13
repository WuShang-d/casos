package controllers

import (
	"sync/atomic"
	"unsafe"

	"github.com/beego/beego/v2/server/web"
	"github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
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
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.Ctx.Output.SetStatus(503)
		c.Data["json"] = map[string]string{"error": "apiserver not ready"}
		c.ServeJSON()
		return
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
