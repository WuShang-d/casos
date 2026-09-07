package wsl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultInstallDistro is the distribution CasOS installs when the host has no
// distro it can turn into a worker node. Ubuntu is the WSL default, it ships
// systemd support and apt, which is what the node deployment expects.
const DefaultInstallDistro = "Ubuntu"

const (
	installTimeout        = 30 * time.Minute
	firstBootTimeout      = 10 * time.Minute
	shortCommandTimeout   = 60 * time.Second
	systemdRestartTimeout = 3 * time.Minute
)

// applianceDistros are distros registered by other products. They boot a
// purpose-built image that cannot host a kubelet, so CasOS never picks one.
var applianceDistros = map[string]bool{
	"docker-desktop":         true,
	"docker-desktop-data":    true,
	"rancher-desktop":        true,
	"rancher-desktop-data":   true,
	"podman-machine-default": true,
}

// ErrVirtualizationUnavailable is permanent: a cloud instance sold without
// nested virtualization answers the same way on every attempt.
var ErrVirtualizationUnavailable = errors.New("this machine cannot run WSL 2 because the Windows hypervisor is not available to it, which is what a cloud VM without nested virtualization looks like: add a Linux machine on the Machines page instead")

// What WSL reports when the hypervisor is missing. 0x80370102 is the one a VM
// that cannot nest returns from WslRegisterDistribution.
var virtualizationErrorMarkers = []string{
	"0X80370102",
	"0X80370101",
	"0X80370114",
	"WSL_E_VM_MODE_NOT_SUPPORTED",
	"WSL_E_NOT_SUPPORTED",
}

// wsl.exe writes the code into its output, not into a distinguishable exit
// status, so the text is all there is to match on.
func virtualizationUnavailable(texts ...string) bool {
	for _, text := range texts {
		upper := strings.ToUpper(text)
		for _, marker := range virtualizationErrorMarkers {
			if strings.Contains(upper, marker) {
				return true
			}
		}
	}
	return false
}

// Distro is one registered WSL distribution.
type Distro struct {
	Name    string `json:"name"`
	State   string `json:"state"`
	Version int    `json:"version"`
	Default bool   `json:"default"`
}

// Usable reports whether a worker node can be deployed into this distro. WSL 1
// has no real kernel and cannot run systemd, which the node services need.
func (d Distro) Usable() bool {
	return d.Version >= 2 && !applianceDistros[strings.ToLower(d.Name)]
}

// Status describes the WSL installation of the local Windows host.
type Status struct {
	CLIAvailable bool     `json:"cliAvailable"`
	Distros      []Distro `json:"distros"`
	// Detail carries what wsl.exe said when no distro could be listed, which is
	// the only useful hint about why WSL is not usable yet.
	Detail string `json:"detail,omitempty"`
}

// NodeDistro returns the distro CasOS should enroll: the default one when it is
// usable, otherwise the first usable one.
func (s *Status) NodeDistro() *Distro {
	if s == nil {
		return nil
	}
	for i := range s.Distros {
		if s.Distros[i].Default && s.Distros[i].Usable() {
			return &s.Distros[i]
		}
	}
	for i := range s.Distros {
		if s.Distros[i].Usable() {
			return &s.Distros[i]
		}
	}
	return nil
}

// Find returns the registered distro called name. WSL treats distro names case
// insensitively, so this does too.
func (s *Status) Find(name string) *Distro {
	if s == nil {
		return nil
	}
	name = strings.TrimSpace(name)
	for i := range s.Distros {
		if strings.EqualFold(s.Distros[i].Name, name) {
			return &s.Distros[i]
		}
	}
	return nil
}

// Detect reports what WSL looks like on this host. A host without WSL is not an
// error: it is the state Install exists to fix.
func Detect(ctx context.Context) (*Status, error) {
	if runtime.GOOS != "windows" {
		return nil, fmt.Errorf("local WSL enrollment is only available when CasOS runs on Windows")
	}
	if _, err := exec.LookPath("wsl.exe"); err != nil {
		return &Status{Detail: "wsl.exe was not found on this host"}, nil
	}

	listCtx, cancel := context.WithTimeout(ctx, shortCommandTimeout)
	defer cancel()
	stdout, stderr, err := output(listCtx, "--list", "--verbose")
	distros := parseDistroList(stdout)
	status := &Status{CLIAvailable: true, Distros: distros}
	if len(distros) == 0 {
		// wsl.exe exits non-zero both when WSL itself is missing and when it is
		// installed without any distro. Either way there is nothing to enroll,
		// and its message is the only thing that tells the two apart.
		status.Detail = summarize(stdout, stderr)
		if err != nil && status.Detail == "no output" {
			status.Detail = err.Error()
		}
	}
	return status, nil
}

// parseDistroList reads `wsl --list --verbose` output. The header is localized,
// so lines are recognised by their shape: a trailing WSL version number, with
// the name in front of the state. A leading "*" marks the default distro.
func parseDistroList(stdout string) []Distro {
	distros := []Distro{}
	for _, line := range strings.Split(strings.ReplaceAll(stdout, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(strings.TrimSpace(line), "\x00")
		if line == "" {
			continue
		}
		isDefault := false
		if strings.HasPrefix(line, "*") {
			isDefault = true
			line = strings.TrimSpace(line[1:])
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		version, err := strconv.Atoi(fields[len(fields)-1])
		if err != nil {
			// The localized header row lands here, as does any banner text.
			continue
		}
		distros = append(distros, Distro{
			Name:    strings.Join(fields[:len(fields)-2], " "),
			State:   fields[len(fields)-2],
			Version: version,
			Default: isDefault,
		})
	}
	return distros
}

// Install registers distro, installing WSL itself first when the host does not
// have it yet. The distro is not launched, so its interactive first-run setup
// never asks the user for an account: CasOS only ever runs commands as root.
//
// It returns the detected distros afterwards so the caller can tell an install
// that finished from one that needs Windows to restart first.
func Install(ctx context.Context, distro string, log func(string)) (*Status, error) {
	if runtime.GOOS != "windows" {
		return nil, fmt.Errorf("local WSL enrollment is only available when CasOS runs on Windows")
	}
	distro = strings.TrimSpace(distro)
	if distro == "" {
		distro = DefaultInstallDistro
	}
	if _, err := exec.LookPath("wsl.exe"); err != nil {
		return nil, fmt.Errorf("wsl.exe was not found on this host, so WSL cannot be installed automatically")
	}

	log(fmt.Sprintf("Installing WSL and the %s distribution, this can take several minutes", distro))
	installCtx, cancel := context.WithTimeout(ctx, installTimeout)
	defer cancel()
	if err := stream(installCtx, log, "--install", "-d", distro, "--no-launch"); err != nil {
		if virtualizationUnavailable(err.Error()) {
			return nil, ErrVirtualizationUnavailable
		}
		// Report the failure, but still detect: an install that only needs a
		// reboot to finish also exits non-zero on some Windows builds.
		status, detectErr := Detect(ctx)
		if detectErr != nil || status.NodeDistro() == nil {
			return status, fmt.Errorf("wsl --install failed: %w (run CasOS as Administrator, or install WSL manually with \"wsl --install\")", err)
		}
		log("wsl --install reported an error but a usable distribution is registered, continuing")
		return status, nil
	}

	status, err := Detect(ctx)
	if err != nil {
		return nil, err
	}
	if status.NodeDistro() == nil {
		// wsl --install exits 0 and registers nothing when the distribution's app
		// package is already on the host, which is what a failed earlier attempt
		// leaves behind.
		if err = registerDistro(ctx, distro, log); err != nil {
			return status, err
		}
		if status, err = Detect(ctx); err != nil {
			return nil, err
		}
	}
	selected := status.NodeDistro()
	if selected == nil {
		return status, fmt.Errorf("WSL was installed but no usable distribution is registered yet: restart Windows to finish enabling WSL, then CasOS will continue automatically")
	}
	if err = warmUp(ctx, selected.Name, log); err != nil {
		return status, err
	}
	return status, nil
}

// registerDistro creates the distribution from the app package already on the
// host; --root keeps the interactive account setup out of the way. It is also
// where a host that cannot run WSL 2 first says so, because everything before
// it succeeds there and only this step starts a virtual machine.
func registerDistro(ctx context.Context, distro string, log func(string)) error {
	launcher := launcherName(distro)
	path, err := exec.LookPath(launcher)
	if err != nil {
		return fmt.Errorf("%s is installed but not registered, and its launcher %s was not found to register it with", distro, launcher)
	}

	log(fmt.Sprintf("Registering %s", distro))
	registerCtx, cancel := context.WithTimeout(ctx, firstBootTimeout)
	defer cancel()
	cmd := exec.CommandContext(registerCtx, path, "install", "--root")
	detachConsole(cmd)
	var combined bytes.Buffer
	cmd.Stdout = &combined
	cmd.Stderr = &combined
	err = cmd.Run()
	text := decodeOutput(combined.Bytes())
	if virtualizationUnavailable(text) {
		return ErrVirtualizationUnavailable
	}
	if err != nil {
		return fmt.Errorf("register %s: %w: %s", distro, err, summarize(text))
	}
	return nil
}

// Ubuntu to ubuntu.exe, Ubuntu-22.04 to ubuntu2204.exe.
func launcherName(distro string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(distro) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String() + ".exe"
}

// warmUp boots a freshly registered distro once. That first boot unpacks the
// distribution image, which takes far longer than any later command, and
// running it as root is what keeps the interactive account setup out of the
// way: CasOS never needs a login user inside the distro.
func warmUp(ctx context.Context, distro string, log func(string)) error {
	log(fmt.Sprintf("Starting %s for the first time", distro))
	bootCtx, cancel := context.WithTimeout(ctx, firstBootTimeout)
	defer cancel()
	stdout, stderr, err := run(bootCtx, distro, true, "echo CASOS_OK=1\n")
	if strings.Contains(stdout, "CASOS_OK=1") {
		return nil
	}
	if virtualizationUnavailable(stdout, stderr) {
		return ErrVirtualizationUnavailable
	}
	if err != nil {
		return fmt.Errorf("start %s: %w: %s", distro, err, summarize(stderr, stdout))
	}
	return fmt.Errorf("start %s: %s", distro, summarize(stdout, stderr))
}

// EnsureSystemd makes distro boot with systemd, which the kubelet and
// kube-proxy services require. It reports whether the distro had to be
// restarted, and only restarts one that was not running systemd already.
func EnsureSystemd(ctx context.Context, distro string, log func(string)) (bool, error) {
	running, err := systemdRunning(ctx, distro)
	if err != nil {
		return false, err
	}
	if running {
		log(fmt.Sprintf("systemd is already running inside %s", displayDistro(distro)))
		return false, nil
	}

	log(fmt.Sprintf("Enabling systemd in %s (/etc/wsl.conf)", displayDistro(distro)))
	writeCtx, cancel := context.WithTimeout(ctx, shortCommandTimeout)
	defer cancel()
	stdout, stderr, err := run(writeCtx, distro, true, enableSystemdScript)
	if err != nil {
		return false, fmt.Errorf("enable systemd in %s: %w: %s", displayDistro(distro), err, summarize(stderr, stdout))
	}
	if !strings.Contains(stdout, "CASOS_OK=1") {
		return false, fmt.Errorf("enable systemd in %s: %s", displayDistro(distro), summarize(stdout, stderr))
	}

	// systemd only takes over at boot. /etc/wsl.conf is read per distro, so
	// terminating this one is enough, and the other distros on the host, which
	// may be enrolled machines or worker nodes themselves, keep running.
	stopCtx, stopCancel := context.WithTimeout(ctx, shortCommandTimeout)
	defer stopCancel()
	if name := strings.TrimSpace(distro); name != "" {
		log(fmt.Sprintf("Restarting %s so systemd becomes PID 1", name))
		if _, stderr, err := output(stopCtx, "--terminate", name); err != nil {
			return false, fmt.Errorf("wsl --terminate %s: %w: %s", name, err, summarize(stderr))
		}
	} else {
		log("Restarting WSL so systemd becomes PID 1 (this stops all running WSL distributions)")
		if _, stderr, err := output(stopCtx, "--shutdown"); err != nil {
			return false, fmt.Errorf("wsl --shutdown: %w: %s", err, summarize(stderr))
		}
	}

	log("Waiting for systemd to come up")
	if err := waitForSystemd(ctx, distro); err != nil {
		return true, err
	}
	log(fmt.Sprintf("systemd is running inside %s", displayDistro(distro)))
	return true, nil
}

func waitForSystemd(ctx context.Context, distro string) error {
	deadline := time.Now().Add(systemdRestartTimeout)
	var lastErr error
	for {
		running, err := systemdRunning(ctx, distro)
		if err == nil && running {
			return nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("PID 1 is not systemd")
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for systemd inside %s after %s: %w",
				displayDistro(distro), systemdRestartTimeout, lastErr)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

// systemdRunning reports whether PID 1 inside distro is systemd. Starting the
// distro is a side effect: WSL boots it to answer the question.
func systemdRunning(ctx context.Context, distro string) (bool, error) {
	probeCtx, cancel := context.WithTimeout(ctx, shortCommandTimeout)
	defer cancel()
	stdout, stderr, err := run(probeCtx, distro, true, `if [ -d /run/systemd/system ] && [ "$(ps -p 1 -o comm=)" = systemd ]; then echo CASOS_SYSTEMD=1; else echo CASOS_SYSTEMD=0; fi`)
	if strings.Contains(stdout, "CASOS_SYSTEMD=1") {
		return true, nil
	}
	if strings.Contains(stdout, "CASOS_SYSTEMD=0") {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("start %s: %w: %s", displayDistro(distro), err, summarize(stderr, stdout))
	}
	return false, fmt.Errorf("could not tell whether systemd runs inside %s: %s", displayDistro(distro), summarize(stdout, stderr))
}

// enableSystemdScript sets systemd=true under [boot] in /etc/wsl.conf, keeping
// every other setting the user may have put there. It is written with awk so it
// works on the busybox tools some distros ship instead of GNU sed.
const enableSystemdScript = `
set -e
conf=/etc/wsl.conf
tmp=/etc/wsl.conf.casos.tmp
[ -f "$conf" ] || : > "$conf"
awk '
BEGIN { inboot = 0; done = 0 }
{
  bare = $0
  gsub(/[ \t]/, "", bare)
  if (bare ~ /^\[.*\]$/) {
    if (tolower(bare) == "[boot]") {
      inboot = 1
      print $0
      print "systemd=true"
      done = 1
      next
    }
    inboot = 0
    print $0
    next
  }
  if (inboot && tolower(bare) ~ /^systemd=/) { next }
  print $0
}
END { if (!done) { print "[boot]"; print "systemd=true" } }
' "$conf" > "$tmp"
chmod 644 "$tmp"
mv "$tmp" "$conf"
echo CASOS_OK=1
`

func displayDistro(distro string) string {
	if distro = strings.TrimSpace(distro); distro != "" {
		return distro
	}
	return "the default WSL distribution"
}

// output runs wsl.exe with args and returns its decoded stdout and stderr.
func output(ctx context.Context, args ...string) (string, string, error) {
	cmd := wslCommand(ctx, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return decodeOutput(stdout.Bytes()), decodeOutput(stderr.Bytes()), err
}

// stream runs wsl.exe with args and forwards its progress lines to log as they
// arrive, so a long install is not a silent wait.
func stream(ctx context.Context, log func(string), args ...string) error {
	cmd := wslCommand(ctx, args...)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		return err
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		forwardProgress(pipe, log)
	}()
	waitErr := cmd.Wait()
	wg.Wait()

	if waitErr != nil {
		if text := summarize(stderr.String()); text != "no output" {
			return fmt.Errorf("%w: %s", waitErr, text)
		}
		return waitErr
	}
	return nil
}

// forwardProgress turns the output of a running wsl.exe into log lines. The
// installer redraws a progress bar with carriage returns, so those split lines
// too, and repeated redraws of the same text are reported once.
func forwardProgress(reader io.Reader, log func(string)) {
	raw := []byte{}
	buf := make([]byte, 4096)
	emitted := 0
	last := ""
	flush := func(final bool) {
		lines := strings.FieldsFunc(decodeOutput(raw), func(r rune) bool { return r == '\n' || r == '\r' })
		limit := len(lines)
		if !final && limit > 0 {
			// The tail may still be growing, so hold it back until more arrives.
			limit--
		}
		for ; emitted < limit; emitted++ {
			line := strings.TrimSpace(lines[emitted])
			if line == "" || line == last {
				continue
			}
			last = line
			log(line)
		}
	}
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			raw = append(raw, buf[:n]...)
			flush(false)
		}
		if err != nil {
			flush(true)
			return
		}
	}
}
