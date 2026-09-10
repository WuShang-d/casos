package deploy

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/beego/beego/logs"
)

// Enrolling the local WSL distro is not request-sized work: a host without WSL
// has to download and register a distribution first, which takes minutes and
// sometimes needs a reboot in between. So the API starts this job and polls it
// instead of holding an HTTP request open long enough to be cut off.

const localWSLEnrollmentLogLimit = 500

// LocalWSLEnrollment is the state of the background enrollment job.
type LocalWSLEnrollment struct {
	// Started is false only before the first enrollment of this server run.
	Started     bool                   `json:"started"`
	Running     bool                   `json:"running"`
	Distro      string                 `json:"distro,omitempty"`
	Logs        []string               `json:"logs"`
	Error       string                 `json:"error,omitempty"`
	Result      *LocalWSLMachineResult `json:"result,omitempty"`
	StartedTime string                 `json:"startedTime,omitempty"`
	UpdatedTime string                 `json:"updatedTime,omitempty"`
}

var localWSLEnrollment = struct {
	mu    sync.Mutex
	state LocalWSLEnrollment
}{}

// StartLocalWSLEnrollment enrolls distro in the background. With no distro it
// picks one, installing WSL and its default distribution first when the host
// has nothing usable. Calling it while a run is in flight reports that run
// instead of starting a second one.
func StartLocalWSLEnrollment(owner, distro string) (LocalWSLEnrollment, error) {
	if runtime.GOOS != "windows" {
		return LocalWSLEnrollment{}, fmt.Errorf("local WSL enrollment is only available when CasOS runs on Windows")
	}

	localWSLEnrollment.mu.Lock()
	if localWSLEnrollment.state.Running {
		defer localWSLEnrollment.mu.Unlock()
		return localWSLEnrollment.state.snapshot(), nil
	}
	distro = strings.TrimSpace(distro)
	localWSLEnrollment.state = LocalWSLEnrollment{
		Started:     true,
		Running:     true,
		Distro:      distro,
		StartedTime: nowStamp(),
		UpdatedTime: nowStamp(),
	}
	snapshot := localWSLEnrollment.state.snapshot()
	localWSLEnrollment.mu.Unlock()

	// The server context, not the request one: the caller's browser must be
	// free to navigate away from a half-hour install without cancelling it.
	go runLocalWSLEnrollment(defaultService.contextSnapshot(), owner, distro)
	return snapshot, nil
}

// GetLocalWSLEnrollment reports the progress of the background enrollment.
func GetLocalWSLEnrollment() LocalWSLEnrollment {
	localWSLEnrollment.mu.Lock()
	defer localWSLEnrollment.mu.Unlock()
	return localWSLEnrollment.state.snapshot()
}

func runLocalWSLEnrollment(ctx context.Context, owner, requested string) {
	defer func() {
		if v := recover(); v != nil {
			finishLocalWSLEnrollment(nil, fmt.Errorf("local WSL enrollment panic: %v", v))
		}
	}()

	log := func(line string) {
		logs.Info("local WSL enrollment: %s", line)
		appendLocalWSLEnrollmentLog(line)
	}

	// The startup bootstrap drives the same distro; running both at once would
	// have them fight over "wsl --shutdown" and over the machine record.
	log("Preparing the local WSL distribution")
	localNodeBootstrapMutex.Lock()
	defer localNodeBootstrapMutex.Unlock()

	distro, err := PrepareLocalWSLDistro(ctx, requested, log)
	if err != nil {
		finishLocalWSLEnrollment(nil, err)
		return
	}
	setLocalWSLEnrollmentDistro(distro)
	startWSLKeepAlive(ctx, distro)

	log(fmt.Sprintf("Enrolling %s as a machine", distro))
	result, err := AddLocalWSLMachine(ctx, owner, distro)
	if err != nil {
		finishLocalWSLEnrollment(nil, fmt.Errorf("enroll %s: %w", distro, err))
		return
	}
	log(fmt.Sprintf("%s is registered as machine %s", distro, result.Machine.Name))
	finishLocalWSLEnrollment(result, nil)
}

func appendLocalWSLEnrollmentLog(line string) {
	localWSLEnrollment.mu.Lock()
	defer localWSLEnrollment.mu.Unlock()
	state := &localWSLEnrollment.state
	state.Logs = append(state.Logs, fmt.Sprintf("%s %s", nowStamp(), line))
	if len(state.Logs) > localWSLEnrollmentLogLimit {
		state.Logs = state.Logs[len(state.Logs)-localWSLEnrollmentLogLimit:]
	}
	state.UpdatedTime = nowStamp()
}

func setLocalWSLEnrollmentDistro(distro string) {
	localWSLEnrollment.mu.Lock()
	defer localWSLEnrollment.mu.Unlock()
	localWSLEnrollment.state.Distro = distro
}

func finishLocalWSLEnrollment(result *LocalWSLMachineResult, err error) {
	localWSLEnrollment.mu.Lock()
	defer localWSLEnrollment.mu.Unlock()
	state := &localWSLEnrollment.state
	state.Running = false
	state.Result = result
	state.UpdatedTime = nowStamp()
	if err != nil {
		state.Error = err.Error()
		logs.Warning("local WSL enrollment failed: %v", err)
	}
}

func (s LocalWSLEnrollment) snapshot() LocalWSLEnrollment {
	s.Logs = append([]string{}, s.Logs...)
	return s
}

func nowStamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}
