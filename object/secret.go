package object

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func GetSecrets(cfg *rest.Config, namespace string) ([]corev1.Secret, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	ns := namespace
	if ns == "" {
		ns = metav1.NamespaceAll
	}
	list, err := client.CoreV1().Secrets(ns).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetSecret(cfg *rest.Config, namespace, name string) (*corev1.Secret, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Secrets(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

func AddSecret(cfg *rest.Config, secret *corev1.Secret) (*corev1.Secret, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Secrets(secret.Namespace).Create(context.Background(), secret, metav1.CreateOptions{})
}

func UpdateSecret(cfg *rest.Config, secret *corev1.Secret) (*corev1.Secret, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Secrets(secret.Namespace).Update(context.Background(), secret, metav1.UpdateOptions{})
}

func DeleteSecret(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	return client.CoreV1().Secrets(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
}
