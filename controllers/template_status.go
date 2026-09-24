package controllers

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type templatePodStatus struct {
	Name  string `json:"name"`
	Job   bool   `json:"job"`
	Phase string `json:"phase"`
	Ready bool   `json:"ready"`
	// Reason is why a container is not running yet, as the kubelet put it:
	// ContainerCreating while its image downloads, CrashLoopBackOff, and so on.
	Reason string `json:"reason"`
	// Progress is the last thing a running Job wrote, which for a download is
	// how far it got.
	Progress string `json:"progress,omitempty"`
}

type templateInstanceStatus struct {
	Pods []templatePodStatus `json:"pods"`
	// Ready means every long-running Pod is Ready and every Job has finished.
	Ready bool `json:"ready"`
}

// GetTemplateInstanceStatus says how far an installed app has come up.
// @router /api/get-template-instance-status [get]
func (c *ApiController) GetTemplateInstanceStatus() {
	if c.RequireSignedIn() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	if namespace == "" {
		namespace = "default"
	}
	name := c.GetString("name")
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(c.Ctx.Request.Context(), 10*time.Second)
	defer cancel()
	list, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s", templateInstanceLabel, name),
	})
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	pods := list.Items

	status := templateInstanceStatus{Pods: []templatePodStatus{}, Ready: len(pods) > 0}
	for _, pod := range pods {
		entry := templatePodStatus{
			Name:   pod.Name,
			Job:    pod.Labels["job-name"] != "",
			Phase:  string(pod.Status.Phase),
			Ready:  podIsReady(pod),
			Reason: podWaitingReason(pod),
		}
		if entry.Job {
			entry.Ready = pod.Status.Phase == corev1.PodSucceeded
			if pod.Status.Phase == corev1.PodRunning {
				entry.Progress = lastLogLine(ctx, client, pod)
			}
		}
		// A Job's failed attempt stays behind while its retry runs.
		if entry.Job && pod.Status.Phase == corev1.PodFailed {
			continue
		}
		if !entry.Ready {
			status.Ready = false
		}
		status.Pods = append(status.Pods, entry)
	}
	sort.Slice(status.Pods, func(i, j int) bool { return status.Pods[i].Name < status.Pods[j].Name })
	c.ResponseOk(status)
}

func podIsReady(pod corev1.Pod) bool {
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady {
			return condition.Status == corev1.ConditionTrue
		}
	}
	return false
}

func podWaitingReason(pod corev1.Pod) string {
	for _, container := range append(pod.Status.InitContainerStatuses, pod.Status.ContainerStatuses...) {
		if container.State.Waiting != nil && container.State.Waiting.Reason != "" {
			return container.State.Waiting.Reason
		}
	}
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodScheduled && condition.Status != corev1.ConditionTrue {
			return condition.Reason
		}
	}
	return ""
}

// lastLogLine keeps only what a progress bar drew last. It redraws in place
// with carriage returns, so its one "line" grows for the whole download; asking
// for the last few seconds rather than the last line keeps the read small.
func lastLogLine(ctx context.Context, client kubernetes.Interface, pod corev1.Pod) string {
	since := int64(10)
	limit := int64(64 << 10)
	stream, err := client.CoreV1().Pods(pod.Namespace).GetLogs(pod.Name, &corev1.PodLogOptions{
		SinceSeconds: &since,
		LimitBytes:   &limit,
	}).Stream(ctx)
	if err != nil {
		return ""
	}
	defer func() { _ = stream.Close() }()
	content, err := io.ReadAll(stream)
	if err != nil {
		return ""
	}
	logs := strings.TrimRight(string(content), "\r\n")
	if index := strings.LastIndexAny(logs, "\r\n"); index >= 0 {
		logs = logs[index+1:]
	}
	return strings.TrimSpace(stripANSI(logs))
}

func stripANSI(text string) string {
	var builder strings.Builder
	for i := 0; i < len(text); i++ {
		if text[i] == 0x1b && i+1 < len(text) && text[i+1] == '[' {
			j := i + 2
			for j < len(text) && (text[j] < 0x40 || text[j] > 0x7e) {
				j++
			}
			i = j
			continue
		}
		builder.WriteByte(text[i])
	}
	return builder.String()
}
