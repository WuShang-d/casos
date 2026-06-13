package object

import (
	"context"
	"sort"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func GetPods(cfg *rest.Config, namespace string) ([]corev1.Pod, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	ns := namespace
	if ns == "" {
		ns = metav1.NamespaceAll
	}
	list, err := client.CoreV1().Pods(ns).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func GetPod(cfg *rest.Config, namespace, name string) (*corev1.Pod, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Pods(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

func AddPod(cfg *rest.Config, pod *corev1.Pod) (*corev1.Pod, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Pods(pod.Namespace).Create(context.Background(), pod, metav1.CreateOptions{})
}

// UpdatePod replaces the pod's metadata (labels) only; pod spec is immutable.
func UpdatePod(cfg *rest.Config, pod *corev1.Pod) (*corev1.Pod, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Pods(pod.Namespace).Update(context.Background(), pod, metav1.UpdateOptions{})
}

func DeletePod(cfg *rest.Config, namespace, name string) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	return client.CoreV1().Pods(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
}

func GetPodEvents(cfg *rest.Config, namespace, name string) ([]corev1.Event, error) {
	client, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	list, err := client.CoreV1().Events(namespace).List(context.Background(), metav1.ListOptions{
		FieldSelector: "involvedObject.name=" + name + ",involvedObject.namespace=" + namespace,
	})
	if err != nil {
		return nil, err
	}
	events := list.Items
	sort.Slice(events, func(i, j int) bool {
		return events[i].LastTimestamp.Before(&events[j].LastTimestamp)
	})
	return events, nil
}
