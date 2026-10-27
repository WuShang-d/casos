package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

//go:embed assets/runner.tar.gz
var runnerBundle []byte

var jobIDPattern = regexp.MustCompile(`^[a-f0-9]{48}$`)
var resultNames = map[string]bool{"thermal-trace.json": true, "channel-result.json": true, "metadata.json": true}

type artifact struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type job struct {
	mu         sync.Mutex
	ID         string     `json:"id"`
	Experiment string     `json:"experiment"`
	Host       string     `json:"host"`
	State      string     `json:"state"`
	Message    string     `json:"message"`
	Log        string     `json:"log"`
	Files      []artifact `json:"files,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	cancel     context.CancelFunc
}

type jobManager struct {
	mu            sync.Mutex
	jobs          map[string]*job
	active        bool
	cooldownUntil time.Time
	dir           string
}

func newJobManager(dir string) (*jobManager, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	manager := &jobManager{jobs: map[string]*job{}, dir: dir}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !jobIDPattern.MatchString(entry.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name(), "job.json"))
		if err != nil {
			continue
		}
		var item job
		if json.Unmarshal(data, &item) != nil || item.ID != entry.Name() {
			continue
		}
		if !terminal(item.State) {
			if deadline := item.UpdatedAt.Add(3 * time.Minute); deadline.After(manager.cooldownUntil) {
				manager.cooldownUntil = deadline
			}
			item.State, item.Message = "interrupted", "服务已重启；远端任务由最长150秒的超时机制终止。请确认结束后重试。"
			manager.save(&item)
		}
		manager.jobs[item.ID] = &item
	}
	return manager, nil
}

func terminal(state string) bool {
	return state == "completed" || state == "failed" || state == "cancelled" || state == "interrupted"
}

func (m *jobManager) save(item *job) {
	data, err := json.Marshal(item)
	if err != nil {
		return
	}
	dir := filepath.Join(m.dir, item.ID)
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	path := filepath.Join(dir, "job.json")
	if os.WriteFile(path+".tmp", data, 0600) == nil {
		_ = os.Rename(path+".tmp", path)
	}
}

func (m *jobManager) update(item *job, state, message string) {
	item.mu.Lock()
	defer item.mu.Unlock()
	if item.State == "cancelling" && state != "cancelled" {
		return
	}
	item.State, item.Message, item.UpdatedAt = state, message, time.Now().UTC()
	m.save(item)
}

func (m *jobManager) create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		probeError(w, 405, "method", "请从检查页面启动任务。")
		return
	}
	if os.Getenv("THERMALSCOPE_ENABLE_JOBS") != "true" {
		probeError(w, 503, "disabled", "此部署尚未启用自动记录。")
		return
	}
	var request struct {
		probeReq
		Experiment             string `json:"experiment"`
		Authorized             bool   `json:"authorized"`
		Bits                   string `json:"bits"`
		DedicatedHostConfirmed bool   `json:"dedicatedHostConfirmed"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&request) != nil {
		probeError(w, 400, "request", "提交的信息不完整。")
		return
	}
	if !request.Authorized {
		probeError(w, 400, "authorization", "请先确认你有权检查这台电脑。")
		return
	}
	if request.Experiment != "thermal" && request.Experiment != "channel" {
		probeError(w, 400, "unsupported", "请选择温度记录或热信号收发实验。")
		return
	}

	var config []byte
	if request.Experiment == "channel" {
		if os.Getenv("THERMALSCOPE_ENABLE_CHANNEL") != "true" {
			probeError(w, 503, "channel_disabled", "此部署尚未启用主动收发实验，请由部署者开启后重试。已有实验结果仍可导入。")
			return
		}
		if !request.DedicatedHostConfirmed {
			probeError(w, 400, "dedicated_host", "请确认目标可用于本次实验，并允许短时 CPU 计算负载。")
			return
		}
		if !regexp.MustCompile(`^[01]{1,8}$`).MatchString(request.Bits) {
			probeError(w, 400, "bits", "请输入 1–8 位 0 或 1。")
			return
		}
		for _, blocked := range strings.Split(os.Getenv("THERMALSCOPE_CHANNEL_BLOCKED_HOSTKEYS"), ",") {
			if blocked != "" && strings.TrimSpace(blocked) == request.HostKeyFingerprint {
				probeError(w, 403, "shared_host", "这台电脑被标记为共享主机，仅允许被动记录，不运行发热实验。")
				return
			}
		}
		config, _ = json.Marshal(map[string]any{"bits": request.Bits, "dedicatedHostConfirmed": true})
	}
	request.Host, request.User = strings.TrimSpace(request.Host), strings.TrimSpace(request.User)
	if request.Host == "" || request.User == "" || request.User == "root" || strings.ContainsAny(request.Host, "/\\ \r\n\t") {
		probeError(w, 400, "account", "请使用普通账号连接有效的电脑地址；自动任务不使用 root 账号。")
		return
	}
	if !strings.HasPrefix(request.HostKeyFingerprint, "SHA256:") {
		probeError(w, 400, "host_identity", "请先重新连接电脑，确认本次检查的目标身份。")
		return
	}
	if request.AuthType != "password" && request.AuthType != "key" {
		probeError(w, 400, "auth_type", "请选择密码或登录密钥。")
		return
	}
	if (request.AuthType == "password" && request.Password == "") || (request.AuthType == "key" && request.PrivateKey == "") {
		probeError(w, 400, "credentials", "请重新填写本次连接的登录信息。")
		return
	}
	port := request.Port
	if port == "" {
		port = "22"
	}
	p, err := strconv.Atoi(port)
	if err != nil || p < 1 || p > 65535 {
		probeError(w, 400, "port", "连接端口不正确。")
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if time.Now().Before(m.cooldownUntil) {
		probeError(w, 409, "cooldown", "上次任务因服务重启中断，请等待远端超时停止后再运行（最长3分钟）。")
		return
	}
	if m.active {
		probeError(w, 409, "busy", "已有检查正在进行，请等待完成或先停止它。")
		return
	}
	if len(m.jobs) >= 20 {
		probeError(w, 409, "history_full", "已保留20个任务，请删除不再需要的历史任务后重试。")
		return
	}
	idBytes := make([]byte, 24)
	if _, err := rand.Read(idBytes); err != nil {
		probeError(w, 500, "id", "无法创建任务，请稍后重试。")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	item := &job{ID: hex.EncodeToString(idBytes), Experiment: request.Experiment, Host: request.Host, State: "connecting", Message: "正在连接电脑", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(), cancel: cancel}
	if err := os.MkdirAll(filepath.Join(m.dir, item.ID, "files"), 0700); err != nil {
		cancel()
		probeError(w, 500, "storage", "任务存储不可用，请检查应用的存储配置。")
		return
	}
	m.jobs[item.ID], m.active = item, true
	m.save(item)
	writeJSON(w, http.StatusAccepted, map[string]string{"id": item.ID})
	go m.run(ctx, item, request.probeReq, config)
}

func (m *jobManager) handle(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/jobs/"), "/")
	if len(parts) == 0 || !jobIDPattern.MatchString(parts[0]) {
		probeError(w, 404, "not_found", "没有找到这个任务。")
		return
	}
	m.mu.Lock()
	item := m.jobs[parts[0]]
	m.mu.Unlock()
	if item == nil {
		probeError(w, 404, "not_found", "没有找到这个任务。")
		return
	}
	if len(parts) == 3 && parts[1] == "files" && resultNames[parts[2]] && r.Method == http.MethodGet {
		item.mu.Lock()
		completed := item.State == "completed"
		item.mu.Unlock()
		if !completed {
			probeError(w, 409, "not_ready", "结果尚未准备好。")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(m.dir, item.ID, "files", parts[2]))
		return
	}
	if len(parts) != 1 {
		probeError(w, 404, "not_found", "没有找到这个任务内容。")
		return
	}
	item.mu.Lock()
	defer item.mu.Unlock()
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, item)
	case http.MethodDelete:
		if terminal(item.State) {
			m.mu.Lock()
			delete(m.jobs, item.ID)
			m.mu.Unlock()
			_ = os.RemoveAll(filepath.Join(m.dir, item.ID))
			writeJSON(w, 200, map[string]string{"status": "deleted"})
			return
		}
		item.State, item.Message = "cancelling", "正在停止本次检查并回收进程"
		m.save(item)
		if item.cancel != nil {
			item.cancel()
		}
		writeJSON(w, 202, map[string]string{"status": "cancelling"})
	default:
		probeError(w, 405, "method", "不支持这个操作。")
	}
}

func connectForJob(ctx context.Context, request probeReq) (*ssh.Client, error) {
	var auth ssh.AuthMethod
	if request.AuthType == "key" {
		signer, err := ssh.ParsePrivateKey([]byte(request.PrivateKey))
		if err != nil {
			return nil, errors.New("登录密钥无法读取，请检查完整内容")
		}
		auth = ssh.PublicKeys(signer)
	} else {
		auth = ssh.Password(request.Password)
	}
	port := strings.TrimSpace(request.Port)
	if port == "" {
		port = "22"
	}
	address := net.JoinHostPort(request.Host, port)
	dialer := net.Dialer{Timeout: 10 * time.Second}
	socket, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, errors.New("无法连接电脑，请检查地址、端口和网络")
	}
	cancelHandshake := context.AfterFunc(ctx, func() { socket.Close() })
	defer cancelHandshake()
	_ = socket.SetDeadline(time.Now().Add(20 * time.Second))
	conn, channels, requests, err := ssh.NewClientConn(socket, address, &ssh.ClientConfig{User: request.User, Auth: []ssh.AuthMethod{auth}, HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != request.HostKeyFingerprint {
			return errors.New("目标电脑身份与连接检查时不一致")
		}
		return nil
	}})
	if err != nil {
		socket.Close()
		if strings.Contains(err.Error(), "目标电脑身份") {
			return nil, errors.New("电脑身份与上次连接时不同，已停止任务；请先核实电脑地址后重新连接")
		}
		return nil, errors.New("未能登录电脑，请检查账号、密码或密钥")
	}
	_ = socket.SetDeadline(time.Time{})
	return ssh.NewClient(conn, channels, requests), nil
}

type jobLog struct {
	manager *jobManager
	item    *job
	pending string
	mu      sync.Mutex
}

func (writer *jobLog) Write(data []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	writer.item.mu.Lock()
	writer.item.Log += string(data)
	if len(writer.item.Log) > 65536 {
		writer.item.Log = writer.item.Log[len(writer.item.Log)-65536:]
	}
	writer.pending += string(data)
	for {
		line, rest, found := strings.Cut(writer.pending, "\n")
		if !found {
			break
		}
		writer.pending = rest
		if strings.HasPrefix(line, "@@phase ") {
			phase := strings.TrimSpace(strings.TrimPrefix(line, "@@phase "))
			messages := map[string]string{"preparing": "正在准备独立运行环境", "running": "正在读取现有热活动", "transmitting": "正在发送热信号并独立接收", "collecting": "正在取回检查记录"}
			if message, ok := messages[phase]; ok && writer.item.State != "cancelling" {
				writer.item.State, writer.item.Message = phase, message
			}
		}
	}
	if len(writer.pending) > 8192 {
		writer.pending = ""
	}
	writer.item.UpdatedAt = time.Now().UTC()
	writer.item.mu.Unlock()
	return len(data), nil
}

func remoteStop(client *ssh.Client, dir string) {
	done := make(chan struct{})
	id := strings.TrimSuffix(filepath.Base(dir), `"`)
	go func() {
		defer close(done)
		session, err := client.NewSession()
		if err != nil {
			return
		}
		defer session.Close()
		_ = session.Run(`mkdir -p ` + dir + ` && cd ` + dir + ` || exit 0; touch .cancelled; for i in 1 2 3 4 5 6 7 8 9 10; do test -f .pgid && break; sleep 0.1; done; if test -f .pgid; then p=$(cat .pgid); case "$p" in ""|*[!0-9]*) exit 1;; esac; if test "$(readlink /proc/$p/cwd)" = "$PWD"; then kill -TERM -- "-$p" 2>/dev/null || true; fi; fi; systemctl --user stop thermalscope-` + id + `.scope >/dev/null 2>&1 || true`)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}

func (m *jobManager) run(ctx context.Context, item *job, request probeReq, config []byte) {
	defer func() {
		item.mu.Lock()
		cancelling := item.State == "cancelling"
		item.mu.Unlock()
		if cancelling {
			m.update(item, "cancelled", "本次检查已停止")
		}
		if item.cancel != nil {
			item.cancel()
		}
		m.mu.Lock()
		m.active = false
		m.mu.Unlock()
	}()
	client, err := connectForJob(ctx, request)
	request.Password, request.PrivateKey = "", ""
	if err != nil {
		m.finishError(item, ctx, err.Error())
		return
	}
	defer client.Close()
	dir := `"$HOME/.cache/thermalscope-viz/jobs/` + item.ID + `"`
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-ctx.Done():
			remoteStop(client, dir)
			client.Close()
		case <-finished:
		}
	}()
	if ctx.Err() != nil {
		m.finishError(item, ctx, "本次检查已停止")
		return
	}
	m.update(item, "uploading", "正在传送本次检查脚本")
	session, err := client.NewSession()
	if err != nil {
		m.finishError(item, ctx, "无法建立传送会话")
		return
	}
	session.Stdin = bytes.NewReader(runnerBundle)
	log := &jobLog{manager: m, item: item}
	session.Stdout, session.Stderr = log, log
	err = session.Run(`umask 077; command -v timeout >/dev/null && command -v setsid >/dev/null && mkdir -p ` + dir + ` && tar -xzf - -C ` + dir)
	session.Close()
	if err != nil {
		m.finishError(item, ctx, "脚本传送失败，请查看运行记录中的原因")
		return
	}
	if ctx.Err() != nil {
		m.finishError(item, ctx, "本次检查已停止")
		return
	}
	session, err = client.NewSession()
	if err != nil {
		m.finishError(item, ctx, "无法建立执行会话")
		return
	}
	session.Stdout, session.Stderr = log, log
	session.Stdin = bytes.NewReader(config)
	command := `cd ` + dir + ` && test ! -f .cancelled && setsid bash -c 'echo $$ > .pgid; test ! -f .cancelled || exit 143; exec timeout --foreground --kill-after=10 150 nice -n 10 bash runner.sh ` + item.Experiment + `'`
	err = session.Run(command)
	session.Close()
	if err != nil {
		m.finishError(item, ctx, "检查未完成，准备或执行步骤失败；请展开运行记录查看具体原因")
		return
	}
	if ctx.Err() != nil {
		m.finishError(item, ctx, "任务已停止")
		return
	}
	m.update(item, "collecting", "正在自动取回并校验检查记录")
	files, err := m.collect(ctx, client, item, dir)
	if err != nil {
		m.finishError(item, ctx, "未能取回完整结果："+err.Error())
		return
	}
	item.mu.Lock()
	if ctx.Err() != nil || item.State == "cancelling" {
		item.State, item.Message = "cancelled", "本次检查已停止"
		_ = os.RemoveAll(filepath.Join(m.dir, item.ID, "files"))
	} else {
		item.Files, item.State, item.Message = files, "completed", "温度记录完成，数据已返回"
		if item.Experiment == "channel" {
			item.Message = "收发实验已结束，请查看实际还原结果；实验结束不代表接收成功"
		}
	}
	item.UpdatedAt = time.Now().UTC()
	m.save(item)
	item.mu.Unlock()
	cleanup, cleanupErr := client.NewSession()
	if cleanupErr == nil {
		done := make(chan struct{})
		go func() { _ = cleanup.Run("rm -rf -- " + dir); close(done) }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
		cleanup.Close()
	}
}

func (m *jobManager) finishError(item *job, ctx context.Context, message string) {
	if ctx.Err() != nil {
		m.update(item, "cancelled", "本次检查已停止；未完成的记录不会作为结果展示")
		return
	}
	m.update(item, "failed", message)
}

func (m *jobManager) collect(ctx context.Context, client *ssh.Client, item *job, dir string) ([]artifact, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()
	output, err := session.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = session.Start(`cd ` + dir + ` && tar -czf - -C results .`); err != nil {
		return nil, err
	}
	compressed, err := gzip.NewReader(io.LimitReader(output, 4<<20))
	if err != nil {
		return nil, err
	}
	defer compressed.Close()
	archive := tar.NewReader(io.LimitReader(compressed, 4<<20))
	var files []artifact
	var total int64
	seen := map[string]bool{}
	required := map[string][]string{"thermal": {"thermal-trace.json", "metadata.json"}, "channel": {"channel-result.json", "metadata.json"}}
	allowed := map[string]bool{}
	for _, name := range required[item.Experiment] {
		allowed[name] = true
	}
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if header.Typeflag == tar.TypeDir {
			continue
		}
		name := strings.TrimPrefix(header.Name, "./")
		if !allowed[name] || seen[name] || header.Typeflag != tar.TypeReg || header.Size < 0 {
			return nil, errors.New("返回了不支持的文件")
		}
		total += header.Size
		if total > 2<<20 || len(files) >= 2 {
			return nil, errors.New("结果超过大小限制")
		}
		data, err := io.ReadAll(io.LimitReader(archive, header.Size+1))
		if err != nil || int64(len(data)) != header.Size {
			return nil, errors.New("结果文件不完整")
		}
		if err = os.WriteFile(filepath.Join(m.dir, item.ID, "files", name), data, 0600); err != nil {
			return nil, err
		}
		seen[name] = true
		files = append(files, artifact{Name: name, Size: header.Size})
	}
	if err = session.Wait(); err != nil {
		return nil, err
	}
	for _, name := range required[item.Experiment] {
		found := false
		for _, f := range files {
			if f.Name == name {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("缺少 %s", name)
		}
	}
	return files, nil
}
