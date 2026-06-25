package controllers

import (
	"encoding/json"
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/casosorg/casos/object"
)

type jobDetailSummary struct {
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	Image           string `json:"image"`
	Command         string `json:"command"`
	Completions     int32  `json:"completions"`
	Parallelism     int32  `json:"parallelism"`
	BackoffLimit    int32  `json:"backoffLimit"`
	Succeeded       int32  `json:"succeeded"`
	Failed          int32  `json:"failed"`
	Active          int32  `json:"active"`
	CreatedAt       string `json:"createdAt"`
	ResourceVersion string `json:"resourceVersion"`
}

func toJobDetailSummary(job batchv1.Job) jobDetailSummary {
	image := ""
	command := ""
	if len(job.Spec.Template.Spec.Containers) > 0 {
		image = job.Spec.Template.Spec.Containers[0].Image
		if len(job.Spec.Template.Spec.Containers[0].Command) > 0 {
			command = fmt.Sprintf("%v", job.Spec.Template.Spec.Containers[0].Command)
		}
	}
	completions := int32(1)
	if job.Spec.Completions != nil {
		completions = *job.Spec.Completions
	}
	parallelism := int32(1)
	if job.Spec.Parallelism != nil {
		parallelism = *job.Spec.Parallelism
	}
	backoffLimit := int32(6)
	if job.Spec.BackoffLimit != nil {
		backoffLimit = *job.Spec.BackoffLimit
	}
	return jobDetailSummary{
		Namespace:       job.Namespace,
		Name:            job.Name,
		Image:           image,
		Command:         command,
		Completions:     completions,
		Parallelism:     parallelism,
		BackoffLimit:    backoffLimit,
		Succeeded:       job.Status.Succeeded,
		Failed:          job.Status.Failed,
		Active:          job.Status.Active,
		CreatedAt:       job.CreationTimestamp.UTC().Format("2006-01-02 15:04:05"),
		ResourceVersion: job.ResourceVersion,
	}
}

type jobRequest struct {
	Namespace       string   `json:"namespace"`
	Name            string   `json:"name"`
	ContainerName   string   `json:"containerName"`
	Image           string   `json:"image"`
	Command         []string `json:"command"`
	Completions     int32    `json:"completions"`
	Parallelism     int32    `json:"parallelism"`
	BackoffLimit    int32    `json:"backoffLimit"`
	ResourceVersion string   `json:"resourceVersion"`
}

func buildJob(req jobRequest) *batchv1.Job {
	containerName := req.ContainerName
	if containerName == "" {
		containerName = req.Name
	}
	completions := req.Completions
	if completions <= 0 {
		completions = 1
	}
	parallelism := req.Parallelism
	if parallelism <= 0 {
		parallelism = 1
	}
	backoffLimit := req.BackoffLimit

	container := corev1.Container{
		Name:  containerName,
		Image: req.Image,
	}
	if len(req.Command) > 0 {
		container.Command = req.Command
	}

	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      req.Name,
			Namespace: req.Namespace,
		},
		Spec: batchv1.JobSpec{
			Completions:  &completions,
			Parallelism:  &parallelism,
			BackoffLimit: &backoffLimit,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"job-name": req.Name},
				},
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					Containers:    []corev1.Container{container},
				},
			},
		},
	}
}

// GetJobs
// @router /api/get-jobs [get]
func (c *ApiController) GetJobs() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	list, err := object.GetJobs(cfg, namespace)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	result := make([]jobDetailSummary, 0, len(list))
	for _, job := range list {
		result = append(result, toJobDetailSummary(job))
	}
	c.ResponseOk(result)
}

// GetJob
// @router /api/get-job [get]
func (c *ApiController) GetJob() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	namespace := c.GetString("namespace")
	name := c.GetString("name")
	job, err := object.GetJob(cfg, namespace, name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toJobDetailSummary(*job))
}

// AddJob
// @router /api/add-job [post]
func (c *ApiController) AddJob() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req jobRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	created, err := object.AddJob(cfg, buildJob(req))
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toJobDetailSummary(*created))
}

// UpdateJob
// @router /api/update-job [post]
func (c *ApiController) UpdateJob() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req jobRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}

	existing, err := object.GetJob(cfg, req.Namespace, req.Name)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}

	backoffLimit := req.BackoffLimit
	existing.Spec.BackoffLimit = &backoffLimit

	if len(existing.Spec.Template.Spec.Containers) > 0 {
		existing.Spec.Template.Spec.Containers[0].Image = req.Image
		if len(req.Command) > 0 {
			existing.Spec.Template.Spec.Containers[0].Command = req.Command
		}
	}
	existing.ResourceVersion = req.ResourceVersion

	updated, err := object.UpdateJob(cfg, existing)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(toJobDetailSummary(*updated))
}

// DeleteJob
// @router /api/delete-job [post]
func (c *ApiController) DeleteJob() {
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("apiserver not ready")
		return
	}
	var req jobRequest
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError("invalid request body: " + err.Error())
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}
	if err := object.DeleteJob(cfg, req.Namespace, req.Name); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}
