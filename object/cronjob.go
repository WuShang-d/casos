package object

import (
	"context"

	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func GetCronJobs(cfg *rest.Config, namespace string) ([]batchv1.CronJob, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	ns := namespace
	if ns == "" {
		ns = metav1.NamespaceAll
	}
	list, err := client.BatchV1().CronJobs(ns).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetCronJob(cfg *rest.Config, namespace, name string) (*batchv1.CronJob, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.BatchV1().CronJobs(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

func AddCronJob(cfg *rest.Config, cj *batchv1.CronJob) (*batchv1.CronJob, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.BatchV1().CronJobs(cj.Namespace).Create(context.Background(), cj, metav1.CreateOptions{})
}

func UpdateCronJob(cfg *rest.Config, cj *batchv1.CronJob) (*batchv1.CronJob, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.BatchV1().CronJobs(cj.Namespace).Update(context.Background(), cj, metav1.UpdateOptions{})
}

func DeleteCronJob(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	return client.BatchV1().CronJobs(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
}
