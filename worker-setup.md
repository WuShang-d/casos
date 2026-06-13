# Worker Node Setup (WSL2)

This guide sets up a Kubernetes worker node inside WSL2 on Windows, connecting it to the casos control plane.

**Requirements:** WSL2 with Ubuntu, systemd enabled (`[boot] systemd=true` in `/etc/wsl.conf`), casos running on Windows.

> **Networking note:** Use NAT mode in `~/.wslconfig` (`networkingMode=NAT`). Mirrored mode has a known WSL2 bug that drops all network interfaces. With NAT, the Windows host is reachable from WSL2 via the default gateway IP.

---

## 1. Fix apt sources (use Tsinghua mirror)

```bash
sudo tee /etc/apt/sources.list.d/ubuntu.sources > /dev/null << 'EOF'
Types: deb
URIs: https://mirrors.tuna.tsinghua.edu.cn/ubuntu
Suites: resolute resolute-updates resolute-backports resolute-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF

sudo apt update
```

## 2. Install containerd

```bash
sudo apt install -y containerd iptables
```

Configure containerd to use the systemd cgroup driver:

```bash
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml > /dev/null
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
```

Start and verify:

```bash
sudo systemctl enable --now containerd
sudo systemctl is-active containerd
```

## 3. Download kubelet

```bash
curl -Lo /tmp/kubelet https://dl.k8s.io/v1.36.1/bin/linux/amd64/kubelet
sudo install -o root -g root -m 0755 /tmp/kubelet /usr/local/bin/kubelet
kubelet --version
```

## 4. Get the Windows host IP

With NAT networking, the Windows host is the default gateway:

```bash
WINDOWS_IP=$(ip route | grep default | awk '{print $3}')
echo "Windows host IP: $WINDOWS_IP"
```

Verify casos is reachable:

```bash
curl -s "http://$WINDOWS_IP:9000/api/get-nodes"
```

## 5. Fetch worker kubeconfig from casos

```bash
sudo mkdir -p /etc/kubernetes

WINDOWS_IP=$(ip route | grep default | awk '{print $3}')

NODE_NAME=$(hostname)

curl -s "http://$WINDOWS_IP:9000/api/get-worker-kubeconfig?nodeName=$NODE_NAME" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
open('/tmp/worker.kubeconfig', 'w').write(d['data']['kubeconfig'])
print('ok')
"

sudo mv /tmp/worker.kubeconfig /etc/kubernetes/worker.kubeconfig
```

The generated kubeconfig points to `https://127.0.0.1:6443`. Replace it with the Windows host IP so kubelet can reach the apiserver from inside WSL2:

```bash
WINDOWS_IP=$(ip route | grep default | awk '{print $3}')
sudo sed -i "s|https://127.0.0.1:6443|https://$WINDOWS_IP:6443|g" /etc/kubernetes/worker.kubeconfig
grep server /etc/kubernetes/worker.kubeconfig
```

## 6. Install CNI plugins

The kubelet requires CNI (Container Network Interface) plugins to set the node `NetworkReady` condition. Without them the node stays `NotReady`.

```bash
sudo mkdir -p /opt/cni/bin /etc/cni/net.d

curl -Lo /tmp/cni-plugins.tgz \
  https://github.com/containernetworking/plugins/releases/download/v1.5.1/cni-plugins-linux-amd64-v1.5.1.tgz
sudo tar -xzf /tmp/cni-plugins.tgz -C /opt/cni/bin
```

Create a minimal bridge network config so the node becomes Ready:

```bash
sudo tee /etc/cni/net.d/10-bridge.conflist > /dev/null << 'EOF'
{
  "cniVersion": "1.0.0",
  "name": "bridge",
  "plugins": [
    {
      "type": "bridge",
      "bridge": "cni0",
      "isGateway": true,
      "ipMasq": true,
      "ipam": {
        "type": "host-local",
        "ranges": [[{"subnet": "10.244.0.0/24"}]],
        "routes": [{"dst": "0.0.0.0/0"}]
      }
    },
    {"type": "portmap", "capabilities": {"portMappings": true}},
    {"type": "loopback"}
  ]
}
EOF
```

## 7. Create kubelet config

In kubelet 1.36+, `nodeName` is set in the config file, not as a CLI flag:

```bash
sudo mkdir -p /var/lib/kubelet

NODE_NAME=$(hostname)
sudo tee /var/lib/kubelet/config.yaml > /dev/null << EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
nodeName: $NODE_NAME
cgroupDriver: systemd
failSwapOn: false
containerRuntimeEndpoint: unix:///run/containerd/containerd.sock
EOF
```

## 8. Create the kubelet systemd service

```bash
sudo tee /etc/systemd/system/kubelet.service > /dev/null << 'EOF'
[Unit]
Description=Kubernetes Kubelet
After=containerd.service
Requires=containerd.service

[Service]
ExecStart=/usr/local/bin/kubelet \
  --kubeconfig=/etc/kubernetes/worker.kubeconfig \
  --config=/var/lib/kubelet/config.yaml \
  --register-node=true \
  --v=2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now kubelet
```

## 9. Verify the node joined the cluster

Check kubelet logs:

```bash
sudo journalctl -u kubelet -n 30 --no-pager
```

Query casos for registered nodes:

```bash
WINDOWS_IP=$(ip route | grep default | awk '{print $3}')
curl -s "http://$WINDOWS_IP:9000/api/get-nodes" | python3 -m json.tool
```

The node should appear with `"status": "Ready"` within 30 seconds.

---

## Troubleshooting

| Symptom                                                           | Cause                                                                            | Fix                                                                                                                                           |
|-------------------------------------------------------------------|----------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `Network is unreachable` in WSL2                                  | `networkingMode=mirrored` failed                                                 | Set `networkingMode=NAT` in `~/.wslconfig`, run `wsl --shutdown`                                                                              |
| `unknown flag: --node-name`                                       | Removed in kubelet 1.36                                                          | Set `nodeName` in `config.yaml` instead                                                                                                       |
| `connection refused` to apiserver                                 | Wrong IP in kubeconfig                                                           | Re-run the `sed` command in step 5 with current `$WINDOWS_IP`                                                                                 |
| `x509: certificate is valid for 127.0.0.1, not <WSL2 gateway IP>` | API server cert was generated before casos included all interface IPs in the SAN | On Windows: delete `<dataDir>/tls/apiserver.crt` and `apiserver.key`, then restart casos — it will regenerate the cert with all interface IPs |
| Node stuck in `NotReady`                                          | containerd not running                                                           | `sudo systemctl status containerd`                                                                                                            |
