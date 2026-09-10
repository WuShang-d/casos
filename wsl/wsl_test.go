package wsl

import (
	"strings"
	"testing"
	"unicode/utf16"
)

func TestParseProvisionOutput(t *testing.T) {
	stdout := strings.Join([]string{
		"Reading package lists...",
		"CASOS_DISTRO=Ubuntu",
		"CASOS_USER=root",
		"CASOS_PORT=2222",
		"CASOS_IP=172.22.149.109",
		"CASOS_IP=172.22.149.109",
		"CASOS_IP=10.0.0.5",
		"CASOS_WARN=could not start sshd: Address already in use",
		"CASOS_OS=Ubuntu 26.04 LTS",
		"CASOS_OK=1",
	}, "\n")

	out, err := parseProvisionOutput(stdout)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.distro != "Ubuntu" || out.username != "root" || out.os != "Ubuntu 26.04 LTS" {
		t.Errorf("unexpected identity fields: %+v", out)
	}
	if out.port != 2222 {
		t.Errorf("port = %d, want 2222", out.port)
	}
	if len(out.hosts) != 2 || out.hosts[0] != "172.22.149.109" || out.hosts[1] != "10.0.0.5" {
		t.Errorf("hosts = %v, want the two distinct addresses in order", out.hosts)
	}
	if len(out.warnings) != 1 {
		t.Errorf("warnings = %v, want one entry", out.warnings)
	}
}

func TestParseProvisionOutputErrors(t *testing.T) {
	if _, err := parseProvisionOutput("CASOS_ERROR=openssh-server is missing\n"); err == nil {
		t.Error("expected an error when the script reports CASOS_ERROR")
	}
	if _, err := parseProvisionOutput("CASOS_DISTRO=Ubuntu\n"); err == nil {
		t.Error("expected an error when the script did not finish")
	}
}

func TestDecodeOutput(t *testing.T) {
	if got := decodeOutput([]byte("plain utf-8\n")); got != "plain utf-8\n" {
		t.Errorf("utf-8 passthrough = %q", got)
	}

	message := "There is no distribution with the supplied name."
	units := utf16.Encode([]rune(message))
	withBOM := []byte{0xFF, 0xFE}
	raw := []byte{}
	for _, unit := range units {
		raw = append(raw, byte(unit), byte(unit>>8))
	}
	if got := decodeOutput(append(withBOM, raw...)); got != message {
		t.Errorf("utf-16 with BOM = %q, want %q", got, message)
	}
	if got := decodeOutput(raw); got != message {
		t.Errorf("utf-16 without BOM = %q, want %q", got, message)
	}
}

func TestProvisionScriptQuotesValues(t *testing.T) {
	script := provisionScript("ssh-rsa AAAA'injected", "ubuntu", 0)
	if strings.Contains(script, "AAAA'injected'") {
		t.Error("single quote in the public key was not escaped")
	}
	if !strings.Contains(script, `PUBKEY='ssh-rsa AAAA'"'"'injected'`) {
		t.Errorf("unexpected PUBKEY assignment in script:\n%s", script[:80])
	}
}

func TestLastNonEmptyLine(t *testing.T) {
	if got := lastNonEmptyLine("motd line\r\nroot\r\n\r\n"); got != "root" {
		t.Errorf("lastNonEmptyLine = %q, want %q", got, "root")
	}
	if got := lastNonEmptyLine("  \n"); got != "" {
		t.Errorf("lastNonEmptyLine = %q, want empty", got)
	}
}
