package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	nodev1 "k8s.io/api/node/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// NVIDIA GPUs on a worker.
//
// A node with an NVIDIA driver gets the NVIDIA container runtime next to runc,
// and a RuntimeClass selects it, so a Pod asks for the GPU with
// runtimeClassName: nvidia rather than through a device plugin. That keeps the
// GPU shared: a home machine runs a chat model and an image model on the same
// card, which a device plugin would hand out whole to one Pod. On WSL the
// driver lives in the Windows host and reaches the distro through /dev/dxg,
// which the toolkit knows how to mount.
//
// The node is labelled the way NVIDIA's GPU feature discovery labels one, so
// anything written against those labels, the nodes page included, reads it.

const (
	NvidiaRuntimeClass       = "nvidia"
	NvidiaGPUPresentLabel    = "nvidia.com/gpu.present"
	nvidiaGPUProductLabel    = "nvidia.com/gpu.product"
	NvidiaGPUMemoryLabel     = "nvidia.com/gpu.memory"
	nvidiaGPUCountLabel      = "nvidia.com/gpu.count"
	nvidiaGPUResource        = "nvidia.com/gpu"
	nodeGPUManagedAnnotation = "casos.io/gpu-managed"
	nvidiaToolkitKeyring     = "/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg"
	nvidiaToolkitSourceList  = "/etc/apt/sources.list.d/nvidia-container-toolkit.list"
)

type nodeGPU struct {
	product   string
	memoryMiB int
	count     int
}

const nvidiaContainerdRuntime = `
[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.nvidia]
  runtime_type = 'io.containerd.runc.v2'
  [plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.nvidia.options]
    BinaryName = '/usr/bin/nvidia-container-runtime'
    SystemdCgroup = true
`

// detectNvidiaGPU asks the driver rather than the PCI bus: a card without a
// working driver is no use to a container either way.
func detectNvidiaGPU(ctx context.Context, runner NodeDeployRunner) (*nodeGPU, error) {
	output, err := runner.RunRootContext(ctx, `if [ -x /usr/lib/wsl/lib/nvidia-smi ]; then
  smi=/usr/lib/wsl/lib/nvidia-smi
elif command -v nvidia-smi >/dev/null 2>&1; then
  smi=nvidia-smi
else
  exit 0
fi
"$smi" --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null || true`)
	if err != nil {
		return nil, err
	}
	return parseNvidiaSmi(output), nil
}

func parseNvidiaSmi(output string) *nodeGPU {
	var gpu *nodeGPU
	for _, line := range strings.Split(output, "\n") {
		name, memory, found := strings.Cut(strings.TrimSpace(line), ",")
		if !found {
			continue
		}
		mib, err := strconv.Atoi(strings.TrimSpace(memory))
		if err != nil {
			continue
		}
		if gpu == nil {
			gpu = &nodeGPU{product: strings.TrimSpace(name), memoryMiB: mib}
		}
		gpu.count++
	}
	return gpu
}

// installNvidiaToolkit adds NVIDIA's apt repository and the toolkit from it.
// The USTC mirror stands in when nvidia.github.io cannot be reached, and a
// repository that failed to install is taken out again, so that a later
// apt-get update on the node does not fail on it.
func installNvidiaToolkit(ctx context.Context, runner NodeDeployRunner) error {
	_, err := runner.RunRootContext(ctx, fmt.Sprintf(`if [ -x /usr/bin/nvidia-container-runtime ]; then
  exit 0
fi
command -v apt-get >/dev/null 2>&1 || { echo "only apt-based distributions are supported" >&2; exit 1; }
base=https://nvidia.github.io/libnvidia-container
curl -fsS --connect-timeout 5 --max-time 10 -o /dev/null "$base/gpgkey" || base=https://mirrors.ustc.edu.cn/libnvidia-container
if ! (set -e
  command -v gpg >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y gnupg
  install -d /usr/share/keyrings
  curl -fsSL --retry 2 "$base/gpgkey" | gpg --batch --yes --dearmor -o %[1]s
  curl -fsSL --retry 2 "$base/stable/deb/nvidia-container-toolkit.list" \
    | sed -e 's#deb https://#deb [signed-by=%[1]s] https://#' -e "s#https://nvidia.github.io/libnvidia-container#$base#" > %[2]s
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-container-toolkit
); then
  rm -f %[2]s
  exit 1
fi`, nvidiaToolkitKeyring, nvidiaToolkitSourceList))
	return err
}

// prepareNodeGPU never fails a deployment: a node without its GPU still runs
// everything else, so trouble here is logged and the GPU left out.
func (d *NodeDeployer) prepareNodeGPU(ctx context.Context, runner NodeDeployRunner) *nodeGPU {
	gpu, err := detectNvidiaGPU(ctx, runner)
	if err != nil {
		d.logStep(nodeDeployPhaseInstalling, fmt.Sprintf("Could not look for an NVIDIA GPU: %v", err))
		return nil
	}
	if gpu == nil {
		return nil
	}
	d.logStep(nodeDeployPhaseInstalling, fmt.Sprintf("Found %s (%d MiB); installing the NVIDIA container toolkit", gpu.product, gpu.memoryMiB))
	if err := installNvidiaToolkit(ctx, runner); err != nil {
		d.logStep(nodeDeployPhaseInstalling, fmt.Sprintf("The NVIDIA container toolkit did not install, so apps on this node run without the GPU: %v", err))
		return nil
	}
	return gpu
}

func gpuLabelValue(product string) string {
	value := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			return r
		}
		return '-'
	}, product)
	if len(value) > 63 {
		value = value[:63]
	}
	return strings.Trim(value, "-_.")
}

// reconcileNodeGPU publishes the GPU on the Node, or takes back what an earlier
// deployment published once the GPU is gone. The capacity is only for display:
// Pods reach the GPU through the RuntimeClass, so nothing requests it.
func (d *NodeDeployer) reconcileNodeGPU(ctx context.Context, nodeName string, gpu *nodeGPU) error {
	client, err := kubernetes.NewForConfig(d.restConfig)
	if err != nil {
		return err
	}
	node, err := client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return err
	}

	if gpu == nil {
		if node.Annotations[nodeGPUManagedAnnotation] != "true" {
			return nil
		}
		labels := map[string]any{}
		for _, key := range []string{NvidiaGPUPresentLabel, nvidiaGPUProductLabel, NvidiaGPUMemoryLabel, nvidiaGPUCountLabel} {
			labels[key] = nil
		}
		patch, _ := json.Marshal(map[string]any{"metadata": map[string]any{
			"labels":      labels,
			"annotations": map[string]any{nodeGPUManagedAnnotation: nil},
		}})
		if _, err := client.CoreV1().Nodes().Patch(ctx, nodeName, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
			return err
		}
		statusPatch := []byte(`[{"op":"remove","path":"/status/capacity/nvidia.com~1gpu"}]`)
		if _, err := client.CoreV1().Nodes().Patch(ctx, nodeName, types.JSONPatchType, statusPatch, metav1.PatchOptions{}, "status"); err != nil && !apierrors.IsInvalid(err) {
			return err
		}
		return nil
	}

	if err := ensureNvidiaRuntimeClass(ctx, client); err != nil {
		return err
	}
	patch, _ := json.Marshal(map[string]any{"metadata": map[string]any{
		"labels": map[string]string{
			NvidiaGPUPresentLabel: "true",
			nvidiaGPUProductLabel: gpuLabelValue(gpu.product),
			NvidiaGPUMemoryLabel:  strconv.Itoa(gpu.memoryMiB),
			nvidiaGPUCountLabel:   strconv.Itoa(gpu.count),
		},
		"annotations": map[string]string{nodeGPUManagedAnnotation: "true"},
	}})
	if _, err := client.CoreV1().Nodes().Patch(ctx, nodeName, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
		return err
	}
	statusPatch, _ := json.Marshal(map[string]any{"status": map[string]any{
		"capacity": map[string]string{nvidiaGPUResource: strconv.Itoa(gpu.count)},
	}})
	_, err = client.CoreV1().Nodes().Patch(ctx, nodeName, types.MergePatchType, statusPatch, metav1.PatchOptions{}, "status")
	return err
}

func ensureNvidiaRuntimeClass(ctx context.Context, client kubernetes.Interface) error {
	desired := &nodev1.RuntimeClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:   NvidiaRuntimeClass,
			Labels: map[string]string{"app.kubernetes.io/managed-by": "casos"},
		},
		Handler: NvidiaRuntimeClass,
		Scheduling: &nodev1.Scheduling{
			NodeSelector: map[string]string{NvidiaGPUPresentLabel: "true"},
		},
	}
	_, err := client.NodeV1().RuntimeClasses().Create(ctx, desired, metav1.CreateOptions{})
	if apierrors.IsAlreadyExists(err) {
		return nil
	}
	return err
}
