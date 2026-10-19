package controllers

import (
	"encoding/json"
	"testing"
)

func TestDiagnoseObjectRegistered(t *testing.T) {
	tool := findMCPTool("diagnose_object")
	if tool == nil {
		t.Fatal("diagnose_object is not registered")
	}
	if !tool.Annotations.ReadOnlyHint {
		t.Error("diagnose_object should be read-only")
	}
	if tool.Annotations.DestructiveHint {
		t.Error("diagnose_object should not be destructive")
	}
}

func TestCanonicalMonitorKind(t *testing.T) {
	cases := map[string]string{
		"pod":                   "Pod",
		"Pod":                   "Pod",
		" NODE ":                "Node",
		"pvc":                   "PersistentVolumeClaim",
		"persistentvolumeclaim": "PersistentVolumeClaim",
		"statefulset":           "StatefulSet",
	}
	for in, want := range cases {
		got, ok := canonicalMonitorKind(in)
		if !ok || got != want {
			t.Errorf("canonicalMonitorKind(%q) = %q, %v; want %q, true", in, got, ok, want)
		}
	}
	if _, ok := canonicalMonitorKind("service"); ok {
		t.Error("canonicalMonitorKind should reject an unsupported kind")
	}
}

func TestDiagnoseObjectRejectsBadArgs(t *testing.T) {
	cases := []string{
		`{"kind":"Pod"}`,                                 // no name
		`{"kind":"Service","name":"x"}`,                  // kind not allowed
		`{"kind":"Pod","name":"Bad Name"}`,               // invalid name
		`{"kind":"Pod","name":"x","ns":"y"}`,             // unknown field
		`{"kind":"Pod","name":"x","namespace":"Bad NS"}`, // invalid namespace
	}
	for _, args := range cases {
		if _, err := mcpDiagnoseObject(t.Context(), nil, json.RawMessage(args)); err == nil {
			t.Errorf("args %s: expected an error, got none", args)
		}
	}
}

// Valid arguments must reach the engine and surface its error rather than
// panicking when no apiserver is reachable.
func TestDiagnoseObjectWithoutApiserver(t *testing.T) {
	if _, err := mcpDiagnoseObject(t.Context(), nil, json.RawMessage(`{"kind":"Pod","name":"demo"}`)); err == nil {
		t.Error("expected an error when the apiserver is unreachable")
	}
}
