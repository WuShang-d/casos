package object

import (
	"context"
	"encoding/json"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
)

func GetDeployments(cfg *rest.Config, namespace string) ([]appsv1.Deployment, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	ns := namespace
	if ns == "" {
		ns = metav1.NamespaceAll
	}
	list, err := client.AppsV1().Deployments(ns).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetDeployment(cfg *rest.Config, namespace, name string) (*appsv1.Deployment, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.AppsV1().Deployments(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

func AddDeployment(cfg *rest.Config, deploy *appsv1.Deployment) (*appsv1.Deployment, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.AppsV1().Deployments(deploy.Namespace).Create(context.Background(), deploy, metav1.CreateOptions{})
}

func UpdateDeployment(cfg *rest.Config, deploy *appsv1.Deployment) (*appsv1.Deployment, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.AppsV1().Deployments(deploy.Namespace).Update(context.Background(), deploy, metav1.UpdateOptions{})
}

func DeleteDeployment(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	return client.AppsV1().Deployments(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
}

func RestartDeployment(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]string{
						"casos.io/restartedAt": time.Now().UTC().Format(time.RFC3339),
					},
				},
			},
		},
	}
	data, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	_, err = client.AppsV1().Deployments(namespace).Patch(
		context.Background(), name, types.MergePatchType, data, metav1.PatchOptions{},
	)
	return err
}
