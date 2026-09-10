package deploy

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/beego/beego/logs"
	"github.com/casosorg/casos/object"
	"github.com/casosorg/casos/wsl"
)

const (
	localWSLMachineNamePrefix = "wsl-"
	localWSLProvisionTimeout  = 5 * time.Minute
	localWSLProbeTimeout      = 8 * time.Second
)

// LocalWSLMachineResult reports what happened while enrolling the local WSL distro.
type LocalWSLMachineResult struct {
	Machine *object.Machine `json:"machine"`
	Distro  string          `json:"distro"`
	Created bool            `json:"created"`
	// Sudo is true when the enrolled user reaches root through sudo instead of
	// already being root.
	Sudo bool `json:"sudo"`
}

// AddLocalWSLMachine registers a WSL distro of the local Windows host as a
// machine. An empty distro selects the default one. It provisions sshd inside
// the distro, installs a generated key pair and verifies the connection, so the
// caller needs no connection details. Running it again for the same distro
// refreshes the address and credential, which is needed because WSL changes its
// IP address on every restart.
func AddLocalWSLMachine(ctx context.Context, owner, distro string) (*LocalWSLMachineResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	owner = strings.TrimSpace(owner)
	if owner == "" {
		owner = "admin"
	}
	if err := wsl.Available(); err != nil {
		return nil, err
	}
	distro = strings.TrimSpace(distro)
	if distro == "" {
		// The default distro is not always the right one: Docker Desktop and
		// friends register distros that cannot host a node, and one of them may
		// well be the default.
		if status, err := wsl.Detect(ctx); err == nil {
			if selected := recommendedWSLDistro(status, owner); selected != nil {
				distro = selected.Name
			}
		}
	}

	// All WSL 2 distros share one network namespace, so a distro that had to
	// move sshd off the configured port asks for the same port again rather
	// than for whatever is free this time.
	preferredPort := 0
	if distro != "" {
		existing, err := object.GetMachine(fmt.Sprintf("%s/%s", owner, localWSLMachineName(distro)))
		if err != nil {
			return nil, err
		}
		if existing != nil {
			preferredPort = existing.Port
		}
	}

	keyPair, err := GenerateNodeDeployKeyPair()
	if err != nil {
		return nil, fmt.Errorf("failed to generate SSH key pair: %w", err)
	}

	provisionCtx, cancel := context.WithTimeout(ctx, localWSLProvisionTimeout)
	defer cancel()
	provisioned, err := wsl.Provision(provisionCtx, distro, keyPair.PublicKey, preferredPort)
	if err != nil {
		return nil, err
	}

	endpoint, err := probeLocalWSLEndpoint(ctx, provisioned, keyPair.PrivateKey)
	if err != nil {
		if len(provisioned.Warnings) > 0 {
			return nil, fmt.Errorf("%w (%s)", err, strings.Join(provisioned.Warnings, "; "))
		}
		return nil, err
	}

	name := localWSLMachineName(provisioned.Distro)
	machine, err := object.GetMachine(fmt.Sprintf("%s/%s", owner, name))
	if err != nil {
		return nil, err
	}

	created := machine == nil
	if created {
		machine = &object.Machine{
			Owner:       owner,
			Name:        name,
			CreatedTime: time.Now().UTC().Format(time.RFC3339),
			DisplayName: localWSLDisplayName(provisioned.Distro),
			Description: "Local WSL distro enrolled by CasOS",
		}
	}
	machine.Ip = endpoint.host
	machine.Port = provisioned.Port
	machine.Username = endpoint.username
	machine.AuthType = "privateKey"
	machine.Password = ""
	machine.PrivateKey = keyPair.PrivateKey
	machine.Os = provisioned.Os
	if machine.Status != object.MachineStatusDeployed {
		machine.Status = "Online"
	}

	if created {
		if _, err = object.AddMachine(machine); err != nil {
			return nil, err
		}
	} else if _, err = object.UpdateMachine(fmt.Sprintf("%s/%s", owner, name), machine); err != nil {
		return nil, err
	}

	logs.Info("enrolled local WSL distro %s as machine %s/%s (%s@%s:%d)",
		provisioned.Distro, owner, name, endpoint.username, endpoint.host, provisioned.Port)

	// Never hand the private key back to API clients.
	response := *machine
	response.PrivateKey = ""
	return &LocalWSLMachineResult{
		Machine: &response,
		Distro:  provisioned.Distro,
		Created: created,
		Sudo:    endpoint.sudo,
	}, nil
}

// LocalWSLDistro is one distro of the local host, as offered for enrollment.
type LocalWSLDistro struct {
	wsl.Distro
	Usable bool `json:"usable"`
	// Recommended marks the distro an enrollment without a choice would pick.
	Recommended bool   `json:"recommended"`
	MachineName string `json:"machineName"`
	Enrolled    bool   `json:"enrolled"`
	Deployed    bool   `json:"deployed"`
}

// LocalWSLDistros lists the distros of the local host for the enrollment
// picker. Detail explains an empty list, which enrollment fixes by installing.
type LocalWSLDistros struct {
	Distros []LocalWSLDistro `json:"distros"`
	Detail  string           `json:"detail,omitempty"`
}

// ListLocalWSLDistros reports every distro of the local host, with the machine
// each one is enrolled as, so a host with several can pick which to add.
func ListLocalWSLDistros(ctx context.Context, owner string) (*LocalWSLDistros, error) {
	status, err := wsl.Detect(ctx)
	if err != nil {
		return nil, err
	}
	recommended := recommendedWSLDistro(status, owner)
	result := &LocalWSLDistros{Distros: []LocalWSLDistro{}, Detail: status.Detail}
	for _, distro := range status.Distros {
		name := localWSLMachineName(distro.Name)
		machine, err := object.GetMachine(fmt.Sprintf("%s/%s", owner, name))
		if err != nil {
			return nil, err
		}
		result.Distros = append(result.Distros, LocalWSLDistro{
			Distro:      distro,
			Usable:      distro.Usable(),
			Recommended: recommended != nil && recommended.Name == distro.Name,
			MachineName: name,
			Enrolled:    machine != nil,
			Deployed:    machine != nil && machine.Status == object.MachineStatusDeployed,
		})
	}
	return result, nil
}

// recommendedWSLDistro is the distro to use when nobody chose one: the one that
// already hosts the worker node, so a changed WSL default does not move the
// node, and otherwise the one wsl.Status.NodeDistro picks.
func recommendedWSLDistro(status *wsl.Status, owner string) *wsl.Distro {
	if status == nil {
		return nil
	}
	for i := range status.Distros {
		distro := &status.Distros[i]
		if !distro.Usable() {
			continue
		}
		machine, err := object.GetMachine(fmt.Sprintf("%s/%s", owner, localWSLMachineName(distro.Name)))
		if err == nil && machine != nil && machine.Status == object.MachineStatusDeployed {
			return distro
		}
	}
	return status.NodeDistro()
}

type localWSLEndpoint struct {
	host     string
	username string
	sudo     bool
}

// probeLocalWSLEndpoint finds the address and user that actually accept the
// generated key. WSL is reachable on its own eth0 address, and on 127.0.0.1
// when localhost forwarding or mirrored networking is enabled.
func probeLocalWSLEndpoint(ctx context.Context, provisioned *wsl.ProvisionResult, privateKey string) (*localWSLEndpoint, error) {
	hosts := append([]string{}, provisioned.Hosts...)
	if !containsString(hosts, "127.0.0.1") {
		hosts = append(hosts, "127.0.0.1")
	}
	users := []string{}
	if provisioned.Username != "" {
		users = append(users, provisioned.Username)
	}
	if !containsString(users, "root") {
		users = append(users, "root")
	}

	var fallback *localWSLEndpoint
	failures := []string{}
	for _, host := range hosts {
		for _, user := range users {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			privileged, err := checkLocalWSLLogin(ctx, host, provisioned.Port, user, privateKey)
			if err != nil {
				failures = append(failures, fmt.Sprintf("%s@%s:%d: %v", user, host, provisioned.Port, err))
				continue
			}
			endpoint := &localWSLEndpoint{host: host, username: user, sudo: privileged == "SUDO"}
			if privileged == "ROOT" || privileged == "SUDO" {
				return endpoint, nil
			}
			if fallback == nil {
				fallback = endpoint
			}
		}
	}
	if fallback != nil {
		return fallback, nil
	}
	return nil, fmt.Errorf("could not reach sshd inside WSL: %s", strings.Join(failures, "; "))
}

// checkLocalWSLLogin returns ROOT, SUDO or NOROOT for a working SSH login.
func checkLocalWSLLogin(ctx context.Context, host string, port int, username, privateKey string) (string, error) {
	runner, err := NewNodeDeploySSHRunner(NodeDeploySSHConfig{
		Host:           host,
		Port:           port,
		Username:       username,
		PrivateKey:     privateKey,
		Timeout:        localWSLProbeTimeout,
		CommandTimeout: localWSLProbeTimeout,
	})
	if err != nil {
		return "", err
	}
	defer runner.Close()

	probeCtx, cancel := context.WithTimeout(ctx, localWSLProbeTimeout)
	defer cancel()
	out, err := runner.RunContext(probeCtx, `if [ "$(id -u)" = 0 ]; then echo ROOT; elif sudo -n true 2>/dev/null; then echo SUDO; else echo NOROOT; fi`)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// localWSLMachineName turns a distro name such as "Ubuntu-22.04" into a machine
// name that passes the same validation as manually added machines.
func localWSLMachineName(distro string) string {
	name := localWSLMachineNamePrefix + sanitizeMachineName(distro, "default")
	if len(name) > 100 {
		name = strings.TrimRight(name[:100], "-")
	}
	return name
}

func localWSLDisplayName(distro string) string {
	distro = strings.TrimSpace(distro)
	if distro == "" {
		return "Local WSL"
	}
	return "WSL: " + distro
}

func collapseDashes(value string) string {
	for strings.Contains(value, "--") {
		value = strings.ReplaceAll(value, "--", "-")
	}
	return value
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
