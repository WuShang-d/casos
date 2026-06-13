package object

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func GetNamespaces(cfg *rest.Config) ([]corev1.Namespace, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	list, err := client.CoreV1().Namespaces().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetNamespace(cfg *rest.Config, name string) (*corev1.Namespace, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Namespaces().Get(context.Background(), name, metav1.GetOptions{})
}

func AddNamespace(cfg *rest.Config, ns *corev1.Namespace) (*corev1.Namespace, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Namespaces().Create(context.Background(), ns, metav1.CreateOptions{})
}

func UpdateNamespace(cfg *rest.Config, ns *corev1.Namespace) (*corev1.Namespace, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Namespaces().Update(context.Background(), ns, metav1.UpdateOptions{})
}

func DeleteNamespace(cfg *rest.Config, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	return client.CoreV1().Namespaces().Delete(context.Background(), name, metav1.DeleteOptions{})
}
