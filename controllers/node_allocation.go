package controllers

import (
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	resourcehelper "k8s.io/component-helpers/resource"
)

type nodeGpu struct {
	Resource    string `json:"resource"`
	Product     string `json:"product"`
	Allocatable int64  `json:"allocatable"`
	Requested   int64  `json:"requested"`
}

// nodeAllocation is what the scheduler sees: allocatable minus the requests of
// the pods bound to the node. Live usage is on the monitor page.
type nodeAllocation struct {
	CpuAllocatableM  int64     `json:"cpuAllocatableM"`
	CpuRequestedM    int64     `json:"cpuRequestedM"`
	CpuFreeM         int64     `json:"cpuFreeM"`
	MemAllocatableMi int64     `json:"memAllocatableMi"`
	MemRequestedMi   int64     `json:"memRequestedMi"`
	MemFreeMi        int64     `json:"memFreeMi"`
	Pods             int       `json:"pods"`
	PodsAllocatable  int64     `json:"podsAllocatable"`
	Gpus             []nodeGpu `json:"gpus"`
	GpuAllocatable   int64     `json:"gpuAllocatable"`
	GpuFree          int64     `json:"gpuFree"`
}

func groupPodsByNode(pods []corev1.Pod) map[string][]*corev1.Pod {
	result := map[string][]*corev1.Pod{}
	for i := range pods {
		pod := &pods[i]
		if pod.Spec.NodeName == "" || pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}
		result[pod.Spec.NodeName] = append(result[pod.Spec.NodeName], pod)
	}
	return result
}

func nodeAllocationOf(node corev1.Node, pods []*corev1.Pod) *nodeAllocation {
	requested := corev1.ResourceList{}
	for _, pod := range pods {
		for name, quantity := range resourcehelper.PodRequests(pod, resourcehelper.PodResourcesOptions{UseStatusResources: true}) {
			sum := requested[name]
			sum.Add(quantity)
			requested[name] = sum
		}
	}

	allocatable := node.Status.Allocatable
	result := &nodeAllocation{
		CpuAllocatableM:  allocatable.Cpu().MilliValue(),
		CpuRequestedM:    requested.Cpu().MilliValue(),
		MemAllocatableMi: allocatable.Memory().Value() / (1024 * 1024),
		MemRequestedMi:   requested.Memory().Value() / (1024 * 1024),
		Pods:             len(pods),
		PodsAllocatable:  allocatable.Pods().Value(),
		Gpus:             []nodeGpu{},
	}
	result.CpuFreeM = max(result.CpuAllocatableM-result.CpuRequestedM, 0)
	result.MemFreeMi = max(result.MemAllocatableMi-result.MemRequestedMi, 0)

	for name, quantity := range allocatable {
		if !isGpuResource(name) || quantity.IsZero() {
			continue
		}
		gpu := nodeGpu{
			Resource:    string(name),
			Product:     gpuProductOf(node, name),
			Allocatable: quantity.Value(),
			Requested:   requested.Name(name, resource.DecimalSI).Value(),
		}
		result.Gpus = append(result.Gpus, gpu)
		result.GpuAllocatable += gpu.Allocatable
		result.GpuFree += max(gpu.Allocatable-gpu.Requested, 0)
	}
	sort.Slice(result.Gpus, func(i, j int) bool { return result.Gpus[i].Resource < result.Gpus[j].Resource })
	return result
}

// Device plugins advertise accelerators as vendor extended resources:
// nvidia.com/gpu, nvidia.com/mig-1g.10gb, amd.com/gpu, gpu.intel.com/i915.
func isGpuResource(name corev1.ResourceName) bool {
	vendor, kind, found := strings.Cut(strings.ToLower(string(name)), "/")
	if !found || strings.HasSuffix(vendor, "kubernetes.io") {
		return false
	}
	return strings.Contains(vendor, "gpu") || strings.Contains(kind, "gpu") || strings.HasPrefix(kind, "mig-")
}

func gpuProductOf(node corev1.Node, name corev1.ResourceName) string {
	vendor, _, _ := strings.Cut(string(name), "/")
	for _, label := range []string{vendor + "/gpu.product", vendor + "/gpu.product-name"} {
		if product := node.Labels[label]; product != "" {
			return product
		}
	}
	return ""
}

func nodeTaints(node corev1.Node) []string {
	taints := []string{}
	for _, taint := range node.Spec.Taints {
		entry := taint.Key
		if taint.Value != "" {
			entry += "=" + taint.Value
		}
		taints = append(taints, entry+":"+string(taint.Effect))
	}
	return taints
}
