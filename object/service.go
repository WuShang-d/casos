package object

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func GetServices(cfg *rest.Config, namespace string) ([]corev1.Service, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	ns := namespace
	if ns == "" {
		ns = metav1.NamespaceAll
	}
	list, err := client.CoreV1().Services(ns).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetService(cfg *rest.Config, namespace, name string) (*corev1.Service, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Services(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

func AddService(cfg *rest.Config, svc *corev1.Service) (*corev1.Service, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Services(svc.Namespace).Create(context.Background(), svc, metav1.CreateOptions{})
}

func UpdateService(cfg *rest.Config, svc *corev1.Service) (*corev1.Service, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Services(svc.Namespace).Update(context.Background(), svc, metav1.UpdateOptions{})
}

func DeleteService(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	return client.CoreV1().Services(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
}
