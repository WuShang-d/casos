package object

import (
	"context"
	"io"
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

// PodOwner identifies the workload controlling a pod.
type PodOwner struct {
	Kind string
	Name string
}

// GetPodOwners maps "namespace/name" to the workload controlling each pod.
// ReplicaSet owners are resolved one level up to their parent Deployment, so a
// pod created by a Deployment reports the Deployment rather than the ReplicaSet.
// Pods without a controller are absent from the map.
func GetPodOwners(cfg *rest.Config, pods []corev1.Pod) (map[string]PodOwner, error) {
	owners := make(map[string]PodOwner, len(pods))
	hasReplicaSet := false
	for i := range pods {
		ref := metav1.GetControllerOf(&pods[i])
		if ref == nil {
			continue
		}
		owners[pods[i].Namespace+"/"+pods[i].Name] = PodOwner{Kind: ref.Kind, Name: ref.Name}
		if ref.Kind == "ReplicaSet" {
			hasReplicaSet = true
		}
	}
	if !hasReplicaSet {
		return owners, nil
	}

	client, err := newClient(cfg)
	if err != nil {
		return owners, err
	}
	list, err := client.AppsV1().ReplicaSets(metav1.NamespaceAll).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return owners, err
	}
	deployOfReplicaSet := make(map[string]string, len(list.Items))
	for i := range list.Items {
		rs := &list.Items[i]
		if ref := metav1.GetControllerOf(rs); ref != nil && ref.Kind == "Deployment" {
			deployOfReplicaSet[rs.Namespace+"/"+rs.Name] = ref.Name
		}
	}

	for i := range pods {
		key := pods[i].Namespace + "/" + pods[i].Name
		owner, ok := owners[key]
		if !ok || owner.Kind != "ReplicaSet" {
			continue
		}
		if deploy, ok := deployOfReplicaSet[pods[i].Namespace+"/"+owner.Name]; ok {
			owners[key] = PodOwner{Kind: "Deployment", Name: deploy}
		}
	}
	return owners, nil
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

func GetPodLogs(cfg *rest.Config, namespace, name, container string, tailLines int64) (string, error) {
	opts := corev1.PodLogOptions{Container: container}
	if tailLines > 0 {
		opts.TailLines = &tailLines
	}
	return GetPodLogsWithOptions(cfg, namespace, name, opts)
}

func GetPodLogsWithOptions(cfg *rest.Config, namespace, name string, opts corev1.PodLogOptions) (string, error) {
	client, err := newClient(cfg)
	if err != nil {
		return "", err
	}
	req := client.CoreV1().Pods(namespace).GetLogs(name, &opts)
	rc, err := req.Stream(context.Background())
	if err != nil {
		return "", err
	}
	defer rc.Close()
	buf, err := io.ReadAll(rc)
	if err != nil {
		return "", err
	}
	return string(buf), nil
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
