package controllers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/rest"

	"github.com/casosorg/casos/object"
)

const (
	mcpGitDefaultWait = 300 * time.Second
	mcpBuildLogLines  = int64(60)
)

var mcpGitTools = []*mcpTool{
	{
		Name:  "deploy_git_repo",
		Title: "Deploy Git repository",
		Description: "Build a public Git repository on casos and deploy it, with no registry needed. " +
			"casos clones the repository, builds its Dockerfile, or builds a Node.js, Python (Procfile, main.py or app.py), Go or static project without one, and deploys the image. " +
			"The first call creates the app with an address; calling it again for the same app rebuilds the latest commit and rolls it out. " +
			"Waits for the build and the rollout, and returns the app's URLs, or the end of the build log when it fails.",
		InputSchema: mcpSchema([]string{"name"}, map[string]interface{}{
			"name":         mcpNameProp,
			"namespace":    mcpNamespaceProp,
			"repo":         mcpProp("string", "Public Git repository, such as https://github.com/owner/project.git. Required when creating the app."),
			"branch":       mcpProp("string", "Branch or tag to build. Defaults to the repository's default branch."),
			"path":         mcpProp("string", "Folder inside the repository to build, for a monorepo. Defaults to the root."),
			"port":         mcpProp("integer", "Port the app listens on. Defaults to its Dockerfile's EXPOSE, or the usual port for the detected stack."),
			"env":          map[string]interface{}{"type": "object", "additionalProperties": map[string]interface{}{"type": "string"}, "description": "Environment variables for a new app, as NAME: value."},
			"wait_seconds": mcpProp("integer", "Seconds to wait for the build and rollout, at most 600. Defaults to 300; 0 returns once the build starts."),
		}),
		Annotations: mcpToolAnnotations{DestructiveHint: true, OpenWorldHint: true},
		handler:     mcpDeployGitRepo,
	},
	{
		Name:        "list_app_builds",
		Title:       "List app builds",
		Description: "List the builds of an app deployed from a Git repository, newest first, with the end of the newest build's log.",
		InputSchema: mcpSchema([]string{"name"}, map[string]interface{}{
			"name":      mcpNameProp,
			"namespace": mcpNamespaceProp,
		}),
		Annotations: mcpToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
		handler:     mcpListAppBuilds,
	},
}

func init() {
	mcpTools = append(mcpTools, mcpGitTools...)
}

type mcpGitDeployResult struct {
	Build    gitBuild      `json:"build"`
	Rollout  *mcpRollout   `json:"rollout,omitempty"`
	App      *mcpAppStatus `json:"app,omitempty"`
	BuildLog string        `json:"buildLog,omitempty"`
	Next     string        `json:"next,omitempty"`
}

func mcpDeployGitRepo(ctx context.Context, cfg *rest.Config, raw json.RawMessage) (interface{}, error) {
	var args struct {
		mcpAppRef
		Repo        string            `json:"repo"`
		Branch      string            `json:"branch"`
		Path        string            `json:"path"`
		Port        *int32            `json:"port"`
		Env         map[string]string `json:"env"`
		WaitSeconds *int              `json:"wait_seconds"`
	}
	if err := decodeMCPArgs(raw, &args); err != nil {
		return nil, err
	}
	if err := args.normalize(); err != nil {
		return nil, err
	}
	req := gitBuildRequest{
		Namespace: args.Namespace,
		Name:      args.Name,
		gitSource: gitSource{Repo: args.Repo, Branch: args.Branch, Path: args.Path},
		EnvVars:   mcpEnvRequests(args.Env),
		domain:    defaultCloudDomain(mcpCallerOf(ctx).host),
	}
	if args.Port != nil {
		req.Port = *args.Port
	}
	build, err := startGitBuild(ctx, cfg, req)
	if err != nil {
		return nil, err
	}

	wait := mcpGitDefaultWait
	if args.WaitSeconds != nil {
		wait = mcpWaitDuration(args.WaitSeconds)
	}
	deadline := time.Now().Add(wait)
	result := mcpGitDeployResult{Build: *build}
	for result.Build.Status != "deployed" && result.Build.Status != "failed" && time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return result, nil
		case <-time.After(3 * time.Second):
		}
		if latest, err := mcpGitBuild(cfg, build.Namespace, build.App, build.Name); err == nil {
			result.Build = *latest
		}
	}

	switch result.Build.Status {
	case "failed":
		result.BuildLog = mcpBuildLog(cfg, result.Build)
		result.Next = "The build failed. Read buildLog, fix the project, push, and call deploy_git_repo again."
	case "deployed":
		rollout := waitForMCPRollout(ctx, cfg, args.Namespace, args.Name, time.Until(deadline))
		result.Rollout = &rollout
		if app, err := mcpAppStatusOf(cfg, args.Namespace, args.Name); err == nil {
			result.App = app
		}
		result.Next = mcpRolloutHint(rollout)
		if result.App != nil && len(result.App.Ports) == 0 {
			result.Next = strings.TrimSpace(result.Next + " casos could not tell which port the app listens on, so it has no address; call deploy_app with port to give it one.")
		}
	default:
		result.Next = "The build is still running. Call list_app_builds to follow it."
	}
	return result, nil
}

func mcpGitBuild(cfg *rest.Config, namespace, app, name string) (*gitBuild, error) {
	builds, err := listGitBuilds(cfg, namespace, app)
	if err != nil {
		return nil, err
	}
	for _, build := range builds {
		if build.Name == name {
			return &build, nil
		}
	}
	return nil, fmt.Errorf("the build %s is gone", name)
}

func mcpBuildLog(cfg *rest.Config, build gitBuild) string {
	if build.PodName == "" {
		return build.Message
	}
	tail := mcpBuildLogLines
	text, err := object.GetPodLogsWithOptions(cfg, build.Namespace, build.PodName, corev1.PodLogOptions{Container: gitBuildContainer, TailLines: &tail})
	if err != nil {
		return fmt.Sprintf("(the build log is unavailable: %v) %s", err, build.Message)
	}
	return text
}

func mcpListAppBuilds(_ context.Context, cfg *rest.Config, raw json.RawMessage) (interface{}, error) {
	var args mcpAppRef
	if err := decodeMCPArgs(raw, &args); err != nil {
		return nil, err
	}
	if err := args.normalize(); err != nil {
		return nil, err
	}
	builds, err := listGitBuilds(cfg, args.Namespace, args.Name)
	if err != nil {
		return nil, err
	}
	if len(builds) == 0 {
		return fmt.Sprintf("%s has no builds; deploy_git_repo builds an app from a repository.", args.Name), nil
	}
	return map[string]interface{}{"builds": builds, "latestLog": mcpBuildLog(cfg, builds[0])}, nil
}
