//go:build !windows

package wsl

import "os/exec"

func detachConsole(*exec.Cmd) {}
