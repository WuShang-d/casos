package util

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func getPidByPort(port int) (int, error) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "netstat -ano | findstr :"+strconv.Itoa(port))
	case "darwin", "linux":
		cmd = exec.Command("lsof", "-t", "-i", ":"+strconv.Itoa(port))
	default:
		return 0, fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return 0, nil
		}
		return 0, nil
	}

	portStr := strconv.Itoa(port)
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if runtime.GOOS == "windows" {
			// match both 0.0.0.0:port and 127.0.0.1:port
			if len(fields) >= 2 && strings.HasSuffix(fields[1], ":"+portStr) {
				pid, err := strconv.Atoi(fields[len(fields)-1])
				if err != nil {
					return 0, err
				}
				return pid, nil
			}
		} else {
			pid, err := strconv.Atoi(fields[0])
			if err != nil {
				return 0, err
			}
			return pid, nil
		}
	}

	return 0, nil
}

func StopOldInstance(port int) error {
	pid, err := getPidByPort(port)
	if err != nil {
		return err
	}
	if pid == 0 {
		return nil
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}

	if err = process.Kill(); err != nil {
		return err
	}

	fmt.Printf("The old instance with pid: %d has been stopped\n", pid)
	return nil
}
