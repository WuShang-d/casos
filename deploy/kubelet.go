package deploy

import (
	"context"
	"fmt"
)

const nodeDeployMaxParallelImagePulls = 3

func (d *NodeDeployer) startKubelet(ctx context.Context, runner NodeDeployRunner) error {
	d.logStep(nodeDeployPhaseStarting, "Starting kubelet")
	if _, err := runner.RunRootContext(ctx, "systemctl daemon-reload && systemctl enable kubelet && systemctl restart kubelet"); err != nil {
		return fmt.Errorf("start kubelet: %w", err)
	}
	return nil
}

func kubeletConfig() string {
	return fmt.Sprintf(`apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: systemd
failSwapOn: false
containerRuntimeEndpoint: unix:///run/containerd/containerd.sock
clusterDNS:
  - %s
clusterDomain: cluster.local
allowedUnsafeSysctls:
  - net.ipv4.ip_forward
  - net.ipv6.conf.all.forwarding
resolvConf: /etc/casos-resolv.conf
# Serial pulls put every app behind the largest image being downloaded: one
# multi-gigabyte AI image on a slow link held up a 20 MB nginx for an hour. The
# cap keeps a burst of installs from splitting the bandwidth too thin.
serializeImagePulls: false
maxParallelImagePulls: %d
`, nodeDeployClusterDNS, nodeDeployMaxParallelImagePulls)
}

func kubeletService(nodeName string) string {
	return fmt.Sprintf(`[Unit]
Description=Kubernetes Kubelet
After=containerd.service
Requires=containerd.service

[Service]
# CSI drivers such as Longhorn use bidirectional mount propagation. WSL starts
# with / private, so their privileged pods fail before the application can
# become ready unless the kubelet first promotes the root mount to rshared.
# Repeating this on ordinary Linux nodes and kubelet restarts is idempotent.
ExecStartPre=/bin/mount --make-rshared /
ExecStart=/usr/local/bin/kubelet \
  --kubeconfig=/etc/kubernetes/worker.kubeconfig \
  --config=/var/lib/kubelet/config.yaml \
  --client-ca-file=/etc/kubernetes/ca.crt \
  --register-node=true \
  --hostname-override=%s \
  --v=2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`, nodeName)
}
