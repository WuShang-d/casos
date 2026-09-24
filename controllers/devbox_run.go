package controllers

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/rest"

	"github.com/casosorg/casos/deploy"
	"github.com/casosorg/casos/object"
)

// A run is a DevBox's command handed to a Job: same image, same home disk, same
// environment, optionally with the GPU. The editor keeps running beside it —
// GPUs are shared through the RuntimeClass, so it holds nothing a run needs.

const (
	devboxRunLabel             = "casos.io/devbox-run"
	devboxRunCommandAnnotation = "casos.io/run-command"
	devboxRunContainer         = "run"
	devboxRunTTLSeconds        = int32(7 * 24 * 60 * 60)
	devboxRunTimeFormat        = "2006-01-02 15:04:05"
	devboxRunPrelude           = `export PATH="$HOME/.local/bin:$PATH"; [ -f "$HOME/.profile" ] && . "$HOME/.profile"` + "\n"
)

type runDevboxRequest struct {
	Namespace   string  `json:"namespace"`
	Devbox      string  `json:"devbox"`
	Command     string  `json:"command"`
	Gpu         bool    `json:"gpu"`
	CpuLimit    *string `json:"cpuLimit"`
	MemoryLimit *string `json:"memoryLimit"`
}

type devboxRun struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Devbox     string `json:"devbox"`
	Command    string `json:"command"`
	Gpu        bool   `json:"gpu"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	PodName    string `json:"podName"`
	CreatedAt  string `json:"createdAt"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt"`
}

// RunDevbox
// @router /api/run-devbox [post]
func (c *ApiController) RunDevbox() {
	if c.RequireAdmin() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req runDevboxRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	req.Command = strings.TrimSpace(req.Command)
	if req.Command == "" {
		c.ResponseError("a command is required")
		return
	}

	depl, err := object.GetDeployment(cfg, req.Namespace, req.Devbox)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	if depl.Labels[devboxLabel] != "true" {
		c.ResponseError(fmt.Sprintf("%s is not a DevBox", req.Devbox))
		return
	}

	node := devboxNode(cfg, depl)
	if req.Gpu {
		if clusterGPU(cfg).Name == "" {
			c.ResponseError("no ready node in this cluster has an NVIDIA GPU")
			return
		}
		if node != "" {
			if n, err := object.GetNode(cfg, node); err == nil && n.Labels[deploy.NvidiaGPUPresentLabel] != "true" {
				c.ResponseError(fmt.Sprintf("this DevBox's home disk is on node %s, which has no GPU", node))
				return
			}
		}
	}

	job, err := buildDevboxRunJob(depl, req, node)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	created, err := object.AddJob(cfg, job)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(devboxRunOf(*created, nil))
}

// GetDevboxRuns returns the runs newest first, and in data2 the GPU a new run could use.
// @router /api/get-devbox-runs [get]
func (c *ApiController) GetDevboxRuns() {
	if c.RequireSignedIn() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	devbox := c.GetString("devbox")

	jobs, err := object.GetJobs(cfg, namespace)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	pods, _ := object.GetPods(cfg, namespace)

	result := []devboxRun{}
	for _, job := range jobs {
		owner := job.Labels[devboxRunLabel]
		if owner == "" || (devbox != "" && owner != devbox) {
			continue
		}
		result = append(result, devboxRunOf(job, pods))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt > result[j].CreatedAt })
	c.ResponseOk(result, clusterGPU(cfg).Name)
}

func activeDevboxRuns(cfg *rest.Config, namespace string) map[string]int {
	result := map[string]int{}
	jobs, err := object.GetJobs(cfg, namespace)
	if err != nil {
		return result
	}
	for _, job := range jobs {
		if devbox := job.Labels[devboxRunLabel]; devbox != "" && devboxRunFinished(job) == nil {
			result[job.Namespace+"/"+devbox]++
		}
	}
	return result
}

// devboxNode is where the editor runs, and so where the home disk is attached.
func devboxNode(cfg *rest.Config, depl *appsv1.Deployment) string {
	selector, err := metav1.LabelSelectorAsSelector(depl.Spec.Selector)
	if err != nil {
		return ""
	}
	pods, err := object.GetPods(cfg, depl.Namespace)
	if err != nil {
		return ""
	}
	for _, pod := range pods {
		if pod.Spec.NodeName != "" && pod.DeletionTimestamp == nil && pod.Status.Phase == corev1.PodRunning && selector.Matches(labels.Set(pod.Labels)) {
			return pod.Spec.NodeName
		}
	}
	return ""
}

func buildDevboxRunJob(depl *appsv1.Deployment, req runDevboxRequest, node string) (*batchv1.Job, error) {
	source := depl.Spec.Template.Spec.DeepCopy()
	if len(source.Containers) == 0 {
		return nil, fmt.Errorf("the DevBox has no container to run from")
	}
	editor := source.Containers[0]

	// The tools volumes are filled by init containers a run does not have, and
	// an /etc/passwd subPath into an empty volume would stop the run starting.
	editorOnly := func(name string) bool { return name == devboxSshVolume || name == devboxToolsVolume }
	var mounts []corev1.VolumeMount
	for _, mount := range editor.VolumeMounts {
		if !editorOnly(mount.Name) {
			mounts = append(mounts, mount)
		}
	}
	var volumes []corev1.Volume
	hasDisk := false
	for _, volume := range source.Volumes {
		if editorOnly(volume.Name) {
			continue
		}
		hasDisk = hasDisk || volume.PersistentVolumeClaim != nil
		volumes = append(volumes, volume)
	}
	if !hasDisk {
		return nil, fmt.Errorf("the DevBox has no home disk, so a run would not see its files")
	}

	container := corev1.Container{
		Name:            devboxRunContainer,
		Image:           editor.Image,
		ImagePullPolicy: editor.ImagePullPolicy,
		// Not a login shell, whose /etc/profile would drop the image's PATH;
		// ~/.profile is still read, for a venv or conda set up there.
		Command:         []string{"/bin/sh", "-c", devboxRunPrelude + req.Command},
		WorkingDir:      devboxFolder(*depl),
		Env:             devboxRunEnv(editor.Env, req.Gpu),
		EnvFrom:         editor.EnvFrom,
		VolumeMounts:    mounts,
		Resources:       editor.Resources,
		SecurityContext: editor.SecurityContext,
	}
	if err := applyResources(&container, resourceRequest{CpuLimit: req.CpuLimit, MemoryLimit: req.MemoryLimit}); err != nil {
		return nil, err
	}

	spec := corev1.PodSpec{
		RestartPolicy:                corev1.RestartPolicyNever,
		Containers:                   []corev1.Container{container},
		Volumes:                      volumes,
		NodeSelector:                 source.NodeSelector,
		Tolerations:                  source.Tolerations,
		Affinity:                     source.Affinity,
		ImagePullSecrets:             source.ImagePullSecrets,
		SecurityContext:              source.SecurityContext,
		ServiceAccountName:           source.ServiceAccountName,
		AutomountServiceAccountToken: source.AutomountServiceAccountToken,
	}
	if req.Gpu {
		runtimeClass := deploy.NvidiaRuntimeClass
		spec.RuntimeClassName = &runtimeClass
	}
	// A ReadWriteOnce disk attaches to one node; the run has to join the editor there.
	if node != "" {
		pinToNode(&spec, node)
	}

	backoff := int32(0)
	ttl := devboxRunTTLSeconds
	podLabels := map[string]string{devboxRunLabel: depl.Name}
	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: depl.Name + "-run-",
			Namespace:    depl.Namespace,
			Labels:       podLabels,
			Annotations:  map[string]string{devboxRunCommandAnnotation: req.Command},
			// Deleting the DevBox takes its runs with it.
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       depl.Name,
				UID:        depl.UID,
			}},
		},
		Spec: batchv1.JobSpec{
			// A failed run is a result, not something to repeat on the same inputs.
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: podLabels},
				Spec:       spec,
			},
		},
	}, nil
}

func devboxRunEnv(env []corev1.EnvVar, gpu bool) []corev1.EnvVar {
	dropped := map[string]bool{"PASSWORD": true, devboxSshKeyEnv: true}
	if gpu {
		dropped["NVIDIA_VISIBLE_DEVICES"] = true
		dropped["NVIDIA_DRIVER_CAPABILITIES"] = true
	}
	result := []corev1.EnvVar{}
	for _, item := range env {
		if !dropped[item.Name] {
			result = append(result, item)
		}
	}
	if gpu {
		result = append(result,
			corev1.EnvVar{Name: "NVIDIA_VISIBLE_DEVICES", Value: "all"},
			corev1.EnvVar{Name: "NVIDIA_DRIVER_CAPABILITIES", Value: "compute,utility"},
		)
	}
	return result
}

func pinToNode(spec *corev1.PodSpec, node string) {
	pin := corev1.NodeSelectorRequirement{Key: "metadata.name", Operator: corev1.NodeSelectorOpIn, Values: []string{node}}
	if spec.Affinity == nil {
		spec.Affinity = &corev1.Affinity{}
	}
	if spec.Affinity.NodeAffinity == nil {
		spec.Affinity.NodeAffinity = &corev1.NodeAffinity{}
	}
	required := spec.Affinity.NodeAffinity.RequiredDuringSchedulingIgnoredDuringExecution
	if required == nil || len(required.NodeSelectorTerms) == 0 {
		spec.Affinity.NodeAffinity.RequiredDuringSchedulingIgnoredDuringExecution = &corev1.NodeSelector{
			NodeSelectorTerms: []corev1.NodeSelectorTerm{{MatchFields: []corev1.NodeSelectorRequirement{pin}}},
		}
		return
	}
	for i := range required.NodeSelectorTerms {
		required.NodeSelectorTerms[i].MatchFields = append(required.NodeSelectorTerms[i].MatchFields, pin)
	}
}

func devboxRunFinished(job batchv1.Job) *batchv1.JobCondition {
	for i, condition := range job.Status.Conditions {
		if condition.Status == corev1.ConditionTrue && (condition.Type == batchv1.JobComplete || condition.Type == batchv1.JobFailed) {
			return &job.Status.Conditions[i]
		}
	}
	return nil
}

func devboxRunOf(job batchv1.Job, pods []corev1.Pod) devboxRun {
	run := devboxRun{
		Name:      job.Name,
		Namespace: job.Namespace,
		Devbox:    job.Labels[devboxRunLabel],
		Command:   job.Annotations[devboxRunCommandAnnotation],
		Gpu:       job.Spec.Template.Spec.RuntimeClassName != nil && *job.Spec.Template.Spec.RuntimeClassName == deploy.NvidiaRuntimeClass,
		Status:    "queued",
		CreatedAt: job.CreationTimestamp.UTC().Format(devboxRunTimeFormat),
	}

	var pod *corev1.Pod
	for i := range pods {
		if pods[i].Namespace == job.Namespace && pods[i].Labels["job-name"] == job.Name &&
			(pod == nil || pods[i].CreationTimestamp.After(pod.CreationTimestamp.Time)) {
			pod = &pods[i]
		}
	}
	var state corev1.ContainerState
	if pod != nil {
		run.PodName = pod.Name
		for _, status := range pod.Status.ContainerStatuses {
			if status.Name == devboxRunContainer {
				state = status.State
			}
		}
	}

	switch {
	case state.Running != nil:
		run.StartedAt = state.Running.StartedAt.UTC().Format(devboxRunTimeFormat)
	case state.Terminated != nil:
		run.StartedAt = state.Terminated.StartedAt.UTC().Format(devboxRunTimeFormat)
	}

	if condition := devboxRunFinished(job); condition != nil {
		run.FinishedAt = condition.LastTransitionTime.UTC().Format(devboxRunTimeFormat)
		if condition.Type == batchv1.JobComplete {
			run.Status = "succeeded"
			return run
		}
		run.Status = "failed"
		run.Message = condition.Message
		if state.Terminated != nil {
			run.Message = fmt.Sprintf("%s, exit code %d", state.Terminated.Reason, state.Terminated.ExitCode)
		}
		return run
	}

	if state.Running != nil {
		run.Status = "running"
		return run
	}
	// A pod still waiting for a node or an image is queued, though the Job counts it active.
	if pod != nil {
		for _, condition := range pod.Status.Conditions {
			if condition.Type == corev1.PodScheduled && condition.Status == corev1.ConditionFalse {
				run.Message = condition.Message
			}
		}
		if state.Waiting != nil && state.Waiting.Reason != "ContainerCreating" {
			run.Message = strings.TrimSpace(state.Waiting.Reason + " " + state.Waiting.Message)
		}
	}
	return run
}
