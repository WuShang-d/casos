package controllers

import (
	"encoding/json"
	"testing"
)

func TestMCPToolRegistryInvariants(t *testing.T) {
	seen := map[string]bool{}
	for _, tool := range mcpTools {
		if tool.Name == "" {
			t.Fatalf("a tool has an empty name")
		}
		if seen[tool.Name] {
			t.Fatalf("duplicate tool name %q", tool.Name)
		}
		seen[tool.Name] = true

		if tool.Description == "" {
			t.Errorf("tool %q has no description", tool.Name)
		}
		if tool.InputSchema["type"] != "object" {
			t.Errorf("tool %q input schema type is %v, want object", tool.Name, tool.InputSchema["type"])
		}
		if tool.handler == nil {
			t.Errorf("tool %q has no handler", tool.Name)
		}
		if tool.Annotations.ReadOnlyHint && tool.Annotations.DestructiveHint {
			t.Errorf("tool %q is marked both read-only and destructive", tool.Name)
		}
	}
}

func TestClusterDiagnosticsToolsRegistered(t *testing.T) {
	for _, name := range []string{"get_cluster_health", "list_cluster_issues"} {
		tool := findMCPTool(name)
		if tool == nil {
			t.Fatalf("tool %q is not registered", name)
		}
		if !tool.Annotations.ReadOnlyHint {
			t.Errorf("tool %q should be read-only", name)
		}
		if tool.Annotations.DestructiveHint {
			t.Errorf("tool %q should not be destructive", name)
		}
	}
}

func TestListClusterIssuesRejectsBadArgs(t *testing.T) {
	cases := []string{
		`{"severity":"fatal"}`,
		`{"namespace":"Not Valid"}`,
		`{"unknown":true}`,
	}
	for _, args := range cases {
		if _, err := mcpListClusterIssues(t.Context(), nil, json.RawMessage(args)); err == nil {
			t.Errorf("args %s: expected an error, got none", args)
		}
	}
}

func TestGetClusterHealthRejectsUnknownArgs(t *testing.T) {
	if _, err := mcpGetClusterHealth(t.Context(), nil, json.RawMessage(`{"foo":1}`)); err == nil {
		t.Errorf("expected an error for an unknown argument, got none")
	}
}

// With no apiserver reachable the tools must still answer: health reports the
// failing checks, and listing issues surfaces the engine's error.
func TestClusterDiagnosticsWithoutApiserver(t *testing.T) {
	result, err := mcpGetClusterHealth(t.Context(), nil, json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("get_cluster_health: unexpected error: %v", err)
	}
	health, ok := result.(mcpClusterHealth)
	if !ok {
		t.Fatalf("get_cluster_health returned %T, want mcpClusterHealth", result)
	}
	if len(health.Problems) == 0 {
		t.Errorf("expected failing checks when the apiserver is unreachable")
	}

	if _, err := mcpListClusterIssues(t.Context(), nil, json.RawMessage(`{}`)); err == nil {
		t.Errorf("list_cluster_issues: expected an error when the apiserver is unreachable")
	}
}
