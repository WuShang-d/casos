//go:build windows

package wsl

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// detachConsole keeps a child off the CasOS console. A distro launcher inherits
// it otherwise and renames the window it is running in.
func detachConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
}
