package object

import (
	"context"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func GetRoleBindings(cfg *rest.Config, namespace string) ([]rbacv1.RoleBinding, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	list, err := client.RbacV1().RoleBindings(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetRoleBinding(cfg *rest.Config, namespace, name string) (*rbacv1.RoleBinding, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.RbacV1().RoleBindings(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

func AddRoleBinding(cfg *rest.Config, rb *rbacv1.RoleBinding) (*rbacv1.RoleBinding, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.RbacV1().RoleBindings(rb.Namespace).Create(context.Background(), rb, metav1.CreateOptions{})
}

func UpdateRoleBinding(cfg *rest.Config, rb *rbacv1.RoleBinding) (*rbacv1.RoleBinding, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.RbacV1().RoleBindings(rb.Namespace).Update(context.Background(), rb, metav1.UpdateOptions{})
}

func DeleteRoleBinding(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	return client.RbacV1().RoleBindings(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
}
