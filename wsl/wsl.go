// Package wsl enrolls the Windows Subsystem for Linux distro that runs on the
// same host as CasOS. It installs an SSH key into the distro so the machine can
// be managed exactly like a remote SSH machine, without asking the user for an
// IP address, port, username or password.
package wsl

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"unicode/utf16"
)

// ProvisionResult describes the local WSL distro after sshd has been prepared.
type ProvisionResult struct {
	Distro   string   `json:"distro"`
	Os       string   `json:"os"`
	Username string   `json:"username"`
	Port     int      `json:"port"`
	Hosts    []string `json:"hosts"`
	// Warnings holds non fatal problems, for example sshd that was already
	// running. They are only interesting when the SSH check later fails.
	Warnings []string `json:"warnings,omitempty"`
}

// Available reports whether the local host can run WSL commands at all.
func Available() error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("local WSL enrollment is only available when CasOS runs on Windows")
	}
	if _, err := exec.LookPath("wsl.exe"); err != nil {
		return fmt.Errorf("wsl.exe was not found on this host, install WSL first")
	}
	return nil
}

// Provision makes sure sshd runs inside distro and authorizes publicKey for
// both the distro's login user and root. An empty distro means the default one.
// preferredPort, when not zero, is the port the distro was reached on before,
// kept when no other distro has taken it since. It returns the addresses the
// caller can use to reach the distro over SSH.
func Provision(ctx context.Context, distro, publicKey string, preferredPort int) (*ProvisionResult, error) {
	if err := Available(); err != nil {
		return nil, err
	}
	publicKey = strings.TrimSpace(publicKey)
	if publicKey == "" || strings.ContainsAny(publicKey, "\r\n") {
		return nil, fmt.Errorf("public key must be a single non-empty line")
	}

	defaultUser, err := defaultUser(ctx, distro)
	if err != nil {
		return nil, err
	}

	stdout, stderr, err := run(ctx, distro, true, provisionScript(publicKey, defaultUser, preferredPort))
	result, parseErr := parseProvisionOutput(stdout)
	if err != nil {
		if result != nil && result.err != "" {
			return nil, fmt.Errorf("WSL provisioning failed: %s", result.err)
		}
		return nil, fmt.Errorf("WSL provisioning failed: %w: %s", err, summarize(stderr, stdout))
	}
	if parseErr != nil {
		return nil, fmt.Errorf("%w: %s", parseErr, summarize(stdout, stderr))
	}

	if result.username == "" {
		result.username = defaultUser
	}
	if result.port == 0 {
		result.port = 22
	}
	if result.distro == "" {
		result.distro = strings.TrimSpace(distro)
	}
	return &ProvisionResult{
		Distro:   result.distro,
		Os:       result.os,
		Username: result.username,
		Port:     result.port,
		Hosts:    result.hosts,
		Warnings: result.warnings,
	}, nil
}

// defaultUser returns the login user of distro, or of the default distro when
// distro is empty.
func defaultUser(ctx context.Context, distro string) (string, error) {
	stdout, stderr, err := run(ctx, distro, false, "id -un\n")
	if err != nil {
		return "", fmt.Errorf("failed to query the default WSL distro: %w: %s", err, summarize(stderr, stdout))
	}
	user := lastNonEmptyLine(stdout)
	if user == "" {
		return "", fmt.Errorf("failed to detect the default WSL user: %s", summarize(stdout, stderr))
	}
	return user, nil
}

type provisionOutput struct {
	distro   string
	os       string
	username string
	port     int
	hosts    []string
	warnings []string
	ok       bool
	err      string
}

func parseProvisionOutput(stdout string) (*provisionOutput, error) {
	out := &provisionOutput{}
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		switch key {
		case "CASOS_DISTRO":
			out.distro = value
		case "CASOS_OS":
			out.os = value
		case "CASOS_USER":
			out.username = value
		case "CASOS_PORT":
			if port, convErr := strconv.Atoi(value); convErr == nil && port > 0 && port < 65536 {
				out.port = port
			}
		case "CASOS_IP":
			if value != "" && !contains(out.hosts, value) {
				out.hosts = append(out.hosts, value)
			}
		case "CASOS_WARN":
			if value != "" {
				out.warnings = append(out.warnings, value)
			}
		case "CASOS_OK":
			out.ok = value == "1"
		case "CASOS_ERROR":
			out.err = value
		}
	}
	if out.err != "" {
		return out, fmt.Errorf("WSL provisioning failed: %s", out.err)
	}
	if !out.ok {
		return out, fmt.Errorf("WSL provisioning did not complete")
	}
	return out, nil
}

// provisionScript is executed as root inside the default WSL distro. It is fed
// through stdin so no value has to survive Windows command line quoting.
func provisionScript(publicKey, defaultUser string, preferredPort int) string {
	var b strings.Builder
	b.WriteString("PUBKEY=" + shellSingleQuote(publicKey) + "\n")
	b.WriteString("DEFAULT_USER=" + shellSingleQuote(defaultUser) + "\n")
	if preferredPort > 0 && preferredPort < 65536 {
		b.WriteString("PREFERRED_PORT=" + strconv.Itoa(preferredPort) + "\n")
	} else {
		b.WriteString("PREFERRED_PORT=\n")
	}
	b.WriteString(`
if [ "$(id -u)" != 0 ]; then
  echo "CASOS_ERROR=the WSL provisioning script did not run as root"
  exit 1
fi

find_sshd() {
  for candidate in /usr/sbin/sshd /usr/bin/sshd /sbin/sshd; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

SSHD=$(find_sshd) || SSHD=""
if [ -z "$SSHD" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y openssh-server >/dev/null 2>&1
  elif command -v yum >/dev/null 2>&1; then
    yum install -y openssh-server >/dev/null 2>&1
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install openssh >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache openssh >/dev/null 2>&1
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm openssh >/dev/null 2>&1
  fi
  SSHD=$(find_sshd) || SSHD=""
fi
if [ -z "$SSHD" ]; then
  echo "CASOS_ERROR=openssh-server is missing in this WSL distro and could not be installed automatically, install it manually and retry"
  exit 1
fi

mkdir -p /run/sshd /var/run/sshd >/dev/null 2>&1
ssh-keygen -A >/dev/null 2>&1

CONFIG_PORT=$(awk '$1 == "Port" && $2 ~ /^[0-9]+$/ { print $2; exit }' /etc/ssh/sshd_config 2>/dev/null)
if [ -z "$CONFIG_PORT" ]; then
  CONFIG_PORT=22
fi

# Every WSL 2 distro shares one network namespace but has a PID namespace of
# its own, so a listening socket no process here holds belongs to another
# distro, whose sshd would answer instead of ours. Prints free, self or other.
port_owner() {
  hex=$(printf '%04X' "$1")
  inodes=$(cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk -v suffix=":$hex" '$4 == "0A" && substr($2, length($2) - 4) == suffix { print $10 }')
  if [ -z "$inodes" ]; then
    echo free
    return
  fi
  links=$(ls -l /proc/[0-9]*/fd/ 2>/dev/null)
  for inode in $inodes; do
    case "$links" in
      *"socket:[$inode]"*)
        echo self
        return
        ;;
    esac
  done
  echo other
}

PORT=""
for candidate in $PREFERRED_PORT $CONFIG_PORT; do
  if [ "$(port_owner "$candidate")" != other ]; then
    PORT=$candidate
    break
  fi
done
if [ -z "$PORT" ]; then
  candidate=2222
  while [ "$candidate" -lt 2322 ]; do
    if [ "$(port_owner "$candidate")" != other ]; then
      PORT=$candidate
      break
    fi
    candidate=$((candidate + 1))
  done
fi
if [ -z "$PORT" ]; then
  echo "CASOS_ERROR=other WSL distributions hold port $CONFIG_PORT and every port from 2222 to 2321, so sshd has nowhere to listen"
  exit 1
fi

install_key() {
  entry=$(getent passwd "$1" 2>/dev/null)
  if [ -z "$entry" ]; then
    return 0
  fi
  uid=$(echo "$entry" | cut -d: -f3)
  gid=$(echo "$entry" | cut -d: -f4)
  home=$(echo "$entry" | cut -d: -f6)
  if [ -z "$home" ] || [ ! -d "$home" ]; then
    return 0
  fi
  mkdir -p "$home/.ssh" || return 0
  chmod 700 "$home/.ssh"
  touch "$home/.ssh/authorized_keys"
  chmod 600 "$home/.ssh/authorized_keys"
  if ! grep -qxF "$PUBKEY" "$home/.ssh/authorized_keys" 2>/dev/null; then
    printf '%s\n' "$PUBKEY" >> "$home/.ssh/authorized_keys"
  fi
  chown -R "$uid:$gid" "$home/.ssh"
}

install_key root
if [ -n "$DEFAULT_USER" ] && [ "$DEFAULT_USER" != root ]; then
  install_key "$DEFAULT_USER"
fi

if [ "$PORT" = "$CONFIG_PORT" ]; then
  started=0
  if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    for svc in ssh sshd; do
      if systemctl cat "$svc.service" >/dev/null 2>&1; then
        systemctl enable "$svc" >/dev/null 2>&1
        if systemctl restart "$svc" >/dev/null 2>&1; then
          started=1
          break
        fi
      fi
    done
  fi
  if [ "$started" != 1 ]; then
    # sshd may already be running from an earlier enrollment; starting a second
    # one simply fails and the caller verifies reachability over SSH anyway.
    if ! out=$("$SSHD" 2>&1); then
      echo "CASOS_WARN=could not start sshd: $(printf '%s' "$out" | tr '\n' ' ')"
    fi
  fi
elif [ "$(port_owner "$PORT")" = free ]; then
  # Another distro holds the configured port. The distro's own ssh service
  # would keep losing that race, so CasOS runs an sshd of its own on a port
  # nobody else uses, and starts it again on every re-enrollment.
  if ! out=$("$SSHD" -p "$PORT" 2>&1); then
    echo "CASOS_WARN=could not start sshd on port $PORT: $(printf '%s' "$out" | tr '\n' ' ')"
  fi
fi

echo "CASOS_DISTRO=${WSL_DISTRO_NAME:-}"
echo "CASOS_USER=$DEFAULT_USER"
echo "CASOS_PORT=$PORT"
# Skip loopback and container bridges, they never reach WSL from Windows.
if command -v ip >/dev/null 2>&1; then
  addrs=$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(lo|docker|cni|flannel|veth|br-|kube|virbr|tailscale)/ { print $4 }' | cut -d/ -f1)
else
  addrs=$(hostname -I 2>/dev/null)
fi
for addr in $addrs; do
  echo "CASOS_IP=$addr"
done
echo "CASOS_OS=$( . /etc/os-release >/dev/null 2>&1; echo "${PRETTY_NAME:-${NAME:-Linux}}" )"
echo "CASOS_OK=1"
`)
	return b.String()
}

// run pipes script into the shell of distro, or of the default distro when
// distro is empty, and returns its output.
func run(ctx context.Context, distro string, asRoot bool, script string) (string, string, error) {
	args := distroArgs(distro)
	if asRoot {
		args = append(args, "-u", "root")
	}
	args = append(args, "--", "sh", "-s")

	cmd := wslCommand(ctx, args...)
	cmd.Stdin = strings.NewReader(script)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return decodeOutput(stdout.Bytes()), decodeOutput(stderr.Bytes()), err
}

// distroArgs returns the wsl.exe arguments that select distro. An empty distro
// leaves the selection to wsl.exe, which then uses the default distro.
func distroArgs(distro string) []string {
	if distro = strings.TrimSpace(distro); distro != "" {
		return []string{"-d", distro}
	}
	return []string{}
}

// wslCommand builds a wsl.exe invocation that reports in UTF-8. Recent WSL
// releases honour WSL_UTF8; older ones ignore it and keep writing UTF-16LE,
// which decodeOutput still handles.
func wslCommand(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "wsl.exe", args...)
	cmd.Env = append(os.Environ(), "WSL_UTF8=1")
	return cmd
}

// decodeOutput converts wsl.exe output to UTF-8. wsl.exe writes its own
// messages as UTF-16LE while the Linux process writes plain UTF-8.
func decodeOutput(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	if len(raw) >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
		return decodeUTF16LE(raw[2:])
	}
	nulls := 0
	for _, b := range raw {
		if b == 0 {
			nulls++
		}
	}
	if nulls*4 >= len(raw) {
		return decodeUTF16LE(raw)
	}
	return string(raw)
}

func decodeUTF16LE(raw []byte) string {
	units := make([]uint16, 0, len(raw)/2)
	for i := 0; i+1 < len(raw); i += 2 {
		units = append(units, uint16(raw[i])|uint16(raw[i+1])<<8)
	}
	return string(utf16.Decode(units))
}

func lastNonEmptyLine(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return ""
}

func summarize(parts ...string) string {
	for _, part := range parts {
		text := strings.TrimSpace(strings.ReplaceAll(part, "\x00", ""))
		if text == "" {
			continue
		}
		text = strings.Join(strings.Fields(text), " ")
		if len(text) > 300 {
			return text[:300] + "..."
		}
		return text
	}
	return "no output"
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// shellSingleQuote returns value quoted as one POSIX shell argument.
func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
