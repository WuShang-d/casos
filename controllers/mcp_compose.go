package controllers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"k8s.io/client-go/rest"
)

var mcpComposeTools = []*mcpTool{
	{
		Name:  "deploy_compose",
		Title: "Deploy docker-compose file",
		Description: "Deploy a docker-compose.yml as one app, in a namespace named after the project. Every service runs and reaches the others by its service name; one that publishes a port gets an address. " +
			"Services must use image:, not build:. ${VAR} is resolved from env. Anything casos cannot carry over, such as a host path or a privileged container, is listed in plan.warnings. " +
			"Waits for every service to roll out. Uninstalling the app (the plan's main service) removes all of it.",
		InputSchema: mcpSchema([]string{"project", "compose"}, map[string]interface{}{
			"project":      mcpProp("string", "Project name: lowercase letters, digits and '-'. It names the namespace, and the app's addresses."),
			"compose":      mcpProp("string", "The docker-compose.yml, as text."),
			"env":          mcpProp("string", "A .env file, as text: the values ${VAR} in the compose file resolves to."),
			"wait_seconds": mcpWaitProp,
		}),
		Annotations: mcpToolAnnotations{DestructiveHint: true, OpenWorldHint: true},
		handler:     mcpDeployCompose,
	},
}

func init() {
	mcpTools = append(mcpTools, mcpComposeTools...)
}

type mcpComposeResult struct {
	Plan     *composePlan          `json:"plan"`
	Rollouts map[string]mcpRollout `json:"rollouts"`
	Next     string                `json:"next,omitempty"`
}

func mcpDeployCompose(ctx context.Context, cfg *rest.Config, raw json.RawMessage) (interface{}, error) {
	var args struct {
		Project     string `json:"project"`
		Compose     string `json:"compose"`
		Env         string `json:"env"`
		WaitSeconds *int   `json:"wait_seconds"`
	}
	if err := decodeMCPArgs(raw, &args); err != nil {
		return nil, err
	}
	plan, err := planCompose(cfg, composeInput{Project: args.Project, Compose: args.Compose, Env: args.Env, domain: defaultCloudDomain(mcpCallerOf(ctx).host)})
	if err != nil {
		return nil, err
	}
	if err := deployCompose(cfg, plan); err != nil {
		return nil, err
	}

	deadline := time.Now().Add(mcpWaitDuration(args.WaitSeconds))
	result := mcpComposeResult{Plan: plan, Rollouts: map[string]mcpRollout{}}
	var failed []string
	for _, service := range plan.Services {
		rollout := waitForMCPRollout(ctx, cfg, plan.Project, service.Name, time.Until(deadline))
		result.Rollouts[service.Name] = rollout
		if rollout.State != mcpRolloutLive {
			failed = append(failed, service.Name)
		}
	}
	if len(failed) > 0 {
		result.Next = fmt.Sprintf("Not everything is up yet: %s. Read get_app_logs and get_app with namespace %s for each to see why.", strings.Join(failed, ", "), plan.Project)
	}
	return result, nil
}
