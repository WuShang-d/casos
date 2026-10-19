package controllers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/rest"

	"github.com/casosorg/casos/object"
)

var mcpObjectDiagnosisTools = []*mcpTool{
	{
		Name:  "diagnose_object",
		Title: "Diagnose object",
		Description: "Diagnose one Kubernetes object: the active problem casos has found for it (if any), its recent events, and a structured summary of what is wrong and what to try next. " +
			"kind is one of Pod, Deployment, StatefulSet, DaemonSet, PersistentVolumeClaim or Node. " +
			"For a Pod, set include_logs to also read a tail of its logs; it is off by default because logs can contain secrets.",
		InputSchema: mcpSchema([]string{"kind", "name"}, map[string]interface{}{
			"kind":             mcpProp("string", "Pod, Deployment, StatefulSet, DaemonSet, PersistentVolumeClaim or Node."),
			"namespace":        mcpProp("string", "The object's namespace. Defaults to \"default\"; ignored for Node."),
			"name":             mcpProp("string", "The object's name."),
			"include_logs":     mcpProp("boolean", "For a Pod, include a tail of its logs. Off by default."),
			"include_previous": mcpProp("boolean", "With include_logs, also read the previous, terminated container's logs."),
			"container":        mcpProp("string", "With include_logs, the container to read. Defaults to the one holding the pod back, or the first."),
			"tail_lines":       mcpProp("integer", "With include_logs, lines to read from the end of each log, at most 100. Defaults to 100."),
		}),
		Annotations: mcpToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
		handler:     mcpDiagnoseObject,
	},
}

func init() {
	mcpTools = append(mcpTools, mcpObjectDiagnosisTools...)
}

// Lowercase and common short forms to the kind the monitor engine and the
// event field selector expect.
var mcpDiagnoseKinds = map[string]string{
	"pod":                   "Pod",
	"deployment":            "Deployment",
	"statefulset":           "StatefulSet",
	"daemonset":             "DaemonSet",
	"pvc":                   "PersistentVolumeClaim",
	"persistentvolumeclaim": "PersistentVolumeClaim",
	"node":                  "Node",
}

func canonicalMonitorKind(kind string) (string, bool) {
	canonical, ok := mcpDiagnoseKinds[strings.ToLower(strings.TrimSpace(kind))]
	return canonical, ok
}

func mcpDiagnoseObject(_ context.Context, cfg *rest.Config, raw json.RawMessage) (interface{}, error) {
	var args struct {
		Kind            string `json:"kind"`
		Namespace       string `json:"namespace"`
		Name            string `json:"name"`
		IncludeLogs     bool   `json:"include_logs"`
		IncludePrevious bool   `json:"include_previous"`
		Container       string `json:"container"`
		TailLines       *int64 `json:"tail_lines"`
	}
	if err := decodeMCPArgs(raw, &args); err != nil {
		return nil, err
	}

	kind, ok := canonicalMonitorKind(args.Kind)
	if !ok {
		return nil, fmt.Errorf("kind must be one of Pod, Deployment, StatefulSet, DaemonSet, PersistentVolumeClaim or Node")
	}
	args.Name = strings.TrimSpace(args.Name)
	if args.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if problems := validation.IsDNS1123Subdomain(args.Name); len(problems) > 0 {
		return nil, fmt.Errorf("name %q is invalid: %s", args.Name, strings.Join(problems, "; "))
	}

	namespace := strings.TrimSpace(args.Namespace)
	if kind == "Node" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}
	if namespace != "" {
		if problems := validation.IsDNS1123Label(namespace); len(problems) > 0 {
			return nil, fmt.Errorf("namespace %q is invalid: %s", namespace, strings.Join(problems, "; "))
		}
	}

	tailLines := int64(0)
	includePrevious := false
	if args.IncludeLogs {
		if args.TailLines != nil {
			tailLines = *args.TailLines
		}
		includePrevious = args.IncludePrevious
	}

	diagnosis, err := object.GetMonitorDiagnosis(cfg, kind, namespace, args.Name, args.Container, tailLines, includePrevious)
	if err != nil {
		return nil, err
	}
	if !args.IncludeLogs {
		diagnosis.LogPreview = nil
	}
	return diagnosis, nil
}
