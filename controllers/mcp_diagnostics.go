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

var mcpDiagnosticsTools = []*mcpTool{
	{
		Name:  "get_cluster_health",
		Title: "Get cluster health",
		Description: "Report the casos cluster's overall health: node and pod counts, the number of warning events, and every health check that is not passing, each with what is wrong and a suggested fix. " +
			"Use it for a first look before deploying, or when an app misbehaves for a reason outside itself.",
		InputSchema: mcpSchema(nil, map[string]interface{}{}),
		Annotations: mcpToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
		handler:     mcpGetClusterHealth,
	},
	{
		Name:  "list_cluster_issues",
		Title: "List cluster issues",
		Description: "List the active problems casos has found across the cluster (unschedulable or crashing pods, not-ready nodes, unbound volumes, and the like), each with the object it concerns, a suggested fix, and the warning events behind it. " +
			"Read an app's own detail with get_app, and its logs with get_app_logs.",
		InputSchema: mcpSchema(nil, map[string]interface{}{
			"severity":  mcpProp("string", "Only issues of this severity: info, warning or critical. Lists every severity when omitted."),
			"namespace": mcpProp("string", "Only issues in this namespace. Cluster-wide when omitted."),
		}),
		Annotations: mcpToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
		handler:     mcpListClusterIssues,
	},
}

func init() {
	mcpTools = append(mcpTools, mcpDiagnosticsTools...)
}

type mcpClusterHealth struct {
	Summary  object.MonitorSummary      `json:"summary"`
	Problems []object.HealthCheckResult `json:"problems,omitempty"`
	Next     string                     `json:"next,omitempty"`
}

func mcpGetClusterHealth(_ context.Context, cfg *rest.Config, raw json.RawMessage) (interface{}, error) {
	var args struct{}
	if err := decodeMCPArgs(raw, &args); err != nil {
		return nil, err
	}
	overview := object.GetMonitorOverview(cfg)
	health := mcpClusterHealth{Summary: overview.Summary}
	for _, check := range overview.Checks {
		if check.Status != object.MonitorStatusHealthy {
			health.Problems = append(health.Problems, check)
		}
	}
	switch {
	case len(health.Problems) > 0:
		health.Next = "Call list_cluster_issues for the objects behind these, then get_app and get_app_logs for an affected app."
	case overview.Summary.OverallStatus == object.MonitorStatusUnknown:
		health.Next = "The cluster's state could not be read; the casos apiserver may still be starting."
	}
	return health, nil
}

func mcpListClusterIssues(_ context.Context, cfg *rest.Config, raw json.RawMessage) (interface{}, error) {
	var args struct {
		Severity  string `json:"severity"`
		Namespace string `json:"namespace"`
	}
	if err := decodeMCPArgs(raw, &args); err != nil {
		return nil, err
	}
	args.Severity = strings.ToLower(strings.TrimSpace(args.Severity))
	args.Namespace = strings.TrimSpace(args.Namespace)
	switch args.Severity {
	case "", object.MonitorSeverityInfo, object.MonitorSeverityWarning, object.MonitorSeverityCritical:
	default:
		return nil, fmt.Errorf("severity must be info, warning or critical")
	}
	if args.Namespace != "" {
		if problems := validation.IsDNS1123Label(args.Namespace); len(problems) > 0 {
			return nil, fmt.Errorf("namespace %q is invalid: %s", args.Namespace, strings.Join(problems, "; "))
		}
	}

	issues, err := object.GetMonitorIssues(cfg)
	if err != nil {
		return nil, err
	}
	result := make([]object.MonitorIssue, 0, len(issues))
	for _, issue := range issues {
		if args.Severity != "" && issue.Severity != args.Severity {
			continue
		}
		if args.Namespace != "" && issue.Namespace != args.Namespace {
			continue
		}
		result = append(result, issue)
	}
	if len(result) == 0 {
		return "No active issues. get_cluster_health shows the health checks behind this.", nil
	}
	return result, nil
}
