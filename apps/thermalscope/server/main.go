package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

var staticDir = envOr("THERMALSCOPE_STATIC_DIR", "/app/build")

const probeScript = `
echo "KERNEL=$(uname -sr)"
echo "ARCH=$(uname -m)"
echo "OS=$(. /etc/os-release 2>/dev/null; echo $PRETTY_NAME)"
echo "VENDOR=$(grep -m1 vendor_id /proc/cpuinfo | awk '{print $3}')"
echo "MODEL=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//')"
echo "NPROC=$(getconf _NPROCESSORS_ONLN 2>/dev/null)"
if command -v python3 >/dev/null 2>&1; then echo PYTHON3=present; else echo PYTHON3=missing; fi
if grep -Eq '^[[:space:]]*TRM:[[:space:]]+[0-9]' /proc/interrupts 2>/dev/null; then echo TRM=present; else echo TRM=missing; fi
throttle=missing
for f in /sys/devices/system/cpu/cpu*/thermal_throttle/*_throttle_count; do
  if test -r "$f" && head -c 32 "$f" 2>/dev/null | grep -Eq '^[0-9]+$'; then throttle=present; break; fi
done
echo "THROTTLE=$throttle"
temperature=missing
for f in /sys/class/hwmon/hwmon*/temp*_input; do
  if test -r "$f" && head -c 32 "$f" 2>/dev/null | grep -Eq '^-?[0-9]+$'; then temperature=present; break; fi
done
echo "TEMPERATURE=$temperature"
virt=$(systemd-detect-virt 2>/dev/null)
case "$virt" in "") virt=unknown ;; esac
echo "VIRT=$virt"
`

type probeReq struct {
	Host               string `json:"host"`
	Port               string `json:"port"`
	User               string `json:"user"`
	AuthType           string `json:"authType"`
	Password           string `json:"password"`
	PrivateKey         string `json:"privateKey"`
	HostKeyFingerprint string `json:"hostKeyFingerprint"`
}

type probeResp struct {
	OK        string            `json:"ok,omitempty"`
	Error     string            `json:"error,omitempty"`
	ErrorCode string            `json:"errorCode,omitempty"`
	Facts     map[string]string `json:"facts,omitempty"`
	Raw       string            `json:"raw,omitempty"`
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func probeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, probeResp{ErrorCode: code, Error: message})
}

func handleProbe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		probeError(w, http.StatusMethodNotAllowed, "method", "请通过连接表单发起检查。")
		return
	}
	var req probeReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&req); err != nil {
		probeError(w, http.StatusBadRequest, "request", "提交的信息格式不正确，请重新填写。")
		return
	}
	req.Host = strings.TrimSpace(req.Host)
	req.User = strings.TrimSpace(req.User)
	if req.Host == "" || req.User == "" || strings.ContainsAny(req.Host, "/\\ \t\r\n") {
		probeError(w, http.StatusBadRequest, "address", "请填写电脑地址和登录账号；地址中不需要填写 http:// 或网页路径。")
		return
	}
	port := strings.TrimSpace(req.Port)
	if port == "" {
		port = "22"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		probeError(w, http.StatusBadRequest, "port", "连接端口需要是 1–65535 之间的数字，请在“更多连接设置”中修改。")
		return
	}

	var auth ssh.AuthMethod
	switch req.AuthType {
	case "key":
		signer, err := ssh.ParsePrivateKey([]byte(req.PrivateKey))
		if err != nil {
			probeError(w, http.StatusBadRequest, "key", "登录密钥无法读取，请粘贴完整内容；暂不支持另外需要口令的密钥。")
			return
		}
		auth = ssh.PublicKeys(signer)
	case "password", "":
		if req.Password == "" {
			probeError(w, http.StatusBadRequest, "password", "请填写登录密码。")
			return
		}
		auth = ssh.Password(req.Password)
	default:
		probeError(w, http.StatusBadRequest, "auth_type", "请选择使用密码或登录密钥。")
		return
	}

	hostFingerprint := ""
	cfg := &ssh.ClientConfig{User: req.User, Auth: []ssh.AuthMethod{auth}, HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		hostFingerprint = ssh.FingerprintSHA256(key)
		return nil
	}}
	address := net.JoinHostPort(req.Host, port)
	dialer := net.Dialer{Timeout: 10 * time.Second}
	socket, err := dialer.DialContext(r.Context(), "tcp", address)
	if err != nil {
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			probeError(w, http.StatusGatewayTimeout, "network_timeout", "连接超时。这台电脑可能未开机，或当前网络无法访问它，请检查地址和网络。")
		} else {
			probeError(w, http.StatusBadGateway, "network", "暂时连不到这台电脑。请检查电脑地址、连接端口，以及电脑是否已开启远程登录。")
		}
		return
	}
	defer socket.Close()
	stopHandshake := context.AfterFunc(r.Context(), func() { socket.Close() })
	defer stopHandshake()
	// Covers the SSH handshake and command, not just the TCP connection.
	_ = socket.SetDeadline(time.Now().Add(30 * time.Second))
	conn, channels, requests, err := ssh.NewClientConn(socket, address, cfg)
	if err != nil {
		if strings.Contains(err.Error(), "unable to authenticate") {
			probeError(w, http.StatusUnauthorized, "authentication", "登录失败。请检查账号和密码，或在“更多连接设置”中选择这台电脑允许的登录方式。")
		} else {
			probeError(w, http.StatusBadGateway, "handshake", "已找到这台电脑，但未能建立登录连接。请确认连接端口和远程登录设置后重试。")
		}
		return
	}
	client := ssh.NewClient(conn, channels, requests)
	defer client.Close()
	closed := make(chan struct{})
	defer close(closed)
	go func() {
		select {
		case <-r.Context().Done():
			_ = client.Close()
		case <-closed:
		}
	}()

	session, err := client.NewSession()
	if err != nil {
		probeError(w, http.StatusBadGateway, "session", "已登录，但这台电脑暂时不允许读取基本情况，请检查账号权限后重试。")
		return
	}
	defer session.Close()
	out, err := session.CombinedOutput(probeScript)
	if err != nil {
		probeError(w, http.StatusBadGateway, "probe", "已登录，但读取电脑基本情况未能完成。请确认账号可以执行基本系统命令后重试。")
		return
	}
	facts := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			facts[k] = v
		}
	}
	if facts["KERNEL"] == "" || facts["ARCH"] == "" {
		probeError(w, http.StatusBadGateway, "facts", "已登录，但没有取得完整的电脑基本情况，请确认电脑系统支持这些检查。")
		return
	}
	facts["HOSTKEY"] = hostFingerprint
	writeJSON(w, http.StatusOK, probeResp{OK: "ok", Facts: facts, Raw: string(out)})
}

func serveStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		probeError(w, http.StatusNotFound, "not_found", "当前服务没有这个功能，请刷新页面后重试。")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clean := filepath.Clean(r.URL.Path)
	full := filepath.Join(staticDir, clean)
	if info, err := os.Stat(full); err == nil && !info.IsDir() {
		http.ServeFile(w, r, full)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/probe", handleProbe)
	jobs, err := newJobManager(envOr("THERMALSCOPE_DATA_DIR", "/tmp/thermalscope-jobs"))
	if err != nil {
		log.Fatal(err)
	}
	mux.HandleFunc("/api/jobs", jobs.create)
	mux.HandleFunc("/api/jobs/", jobs.handle)
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "version": "0.1.0", "channelEnabled": os.Getenv("THERMALSCOPE_ENABLE_CHANNEL") == "true", "runnerSHA256": fmt.Sprintf("%x", sha256.Sum256(runnerBundle))})
	})
	mux.HandleFunc("/", serveStatic)
	srv := &http.Server{Addr: envOr("THERMALSCOPE_ADDR", "127.0.0.1:25176"), Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
