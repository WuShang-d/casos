package object

import (
	"context"
	"fmt"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func GetJobs(cfg *rest.Config, namespace string) ([]batchv1.Job, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	ns := namespace
	if ns == "" {
		ns = metav1.NamespaceAll
	}
	list, err := client.BatchV1().Jobs(ns).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetJob(cfg *rest.Config, namespace, name string) (*batchv1.Job, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.BatchV1().Jobs(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

func AddJob(cfg *rest.Config, job *batchv1.Job) (*batchv1.Job, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.BatchV1().Jobs(job.Namespace).Create(context.Background(), job, metav1.CreateOptions{})
}

func UpdateJob(cfg *rest.Config, job *batchv1.Job) (*batchv1.Job, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.BatchV1().Jobs(job.Namespace).Update(context.Background(), job, metav1.UpdateOptions{})
}

func DeleteJob(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	propagation := metav1.DeletePropagationBackground
	return client.BatchV1().Jobs(namespace).Delete(context.Background(), name, metav1.DeleteOptions{
		PropagationPolicy: &propagation,
	})
}

// GetJobsByCronJob returns all Jobs owned by the given CronJob.
func GetJobsByCronJob(cfg *rest.Config, namespace, cronJobName string) ([]batchv1.Job, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	list, err := client.BatchV1().Jobs(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	var result []batchv1.Job
	for _, job := range list.Items {
		for _, ref := range job.OwnerReferences {
			if ref.Kind == "CronJob" && ref.Name == cronJobName {
				result = append(result, job)
				break
			}
		}
	}
	return result, nil
}

// GetJobPodName returns the name of the first Pod created by the given Job.
func GetJobPodName(cfg *rest.Config, namespace, jobName string) (string, error) {
	client, err := newClient(cfg)
	if err != nil {
		return "", err
	}
	pods, err := client.CoreV1().Pods(namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: fmt.Sprintf("job-name=%s", jobName),
	})
	if err != nil {
		return "", err
	}
	if len(pods.Items) == 0 {
		return "", nil
	}
	return pods.Items[0].Name, nil
}

// TriggerCronJob manually creates a Job from a CronJob's job template.
func TriggerCronJob(cfg *rest.Config, namespace, cronJobName string) (*batchv1.Job, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	cj, err := client.BatchV1().CronJobs(namespace).Get(context.Background(), cronJobName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	suffix := time.Now().UTC().Format("20060102-150405")
	jobName := fmt.Sprintf("%s-manual-%s", cronJobName, suffix)

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: namespace,
			Labels: map[string]string{
				"casos.io/triggered-by": "manual",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "batch/v1",
					Kind:       "CronJob",
					Name:       cj.Name,
					UID:        cj.UID,
				},
			},
		},
		Spec: cj.Spec.JobTemplate.Spec,
	}

	// Ensure RestartPolicy is set (required for Jobs).
	if job.Spec.Template.Spec.RestartPolicy == corev1.RestartPolicy("") {
		job.Spec.Template.Spec.RestartPolicy = corev1.RestartPolicyNever
	}

	return client.BatchV1().Jobs(namespace).Create(context.Background(), job, metav1.CreateOptions{})
}
