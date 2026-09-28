package controllers

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/beego/beego/logs"
	"github.com/casosorg/casos/object"
	proxypkg "github.com/casosorg/casos/proxy"
	"github.com/casosorg/casos/store"
	"k8s.io/client-go/rest"
)

const helmOperationTaskNotFoundCode = "helm_task_not_found"

func helmErrorResponse(err error) Response {
	response := Response{Status: "error", Msg: err.Error()}
	if info, ok := store.HelmCompatibilityErrorInfoFrom(err); ok {
		response.Data = info
	}
	return response
}

func (c *ApiController) responseHelmError(err error) {
	c.Data["json"] = helmErrorResponse(err)
	c.ServeJSON()
}

func writeHelmInstallStreamEvent(w io.Writer, event store.HelmInstallStreamEvent) error {
	return writeHelmStreamEvent(w, "install", event)
}

func writeHelmChartValuesStreamEvent(w io.Writer, event store.HelmChartValuesStreamEvent) error {
	return writeHelmStreamEvent(w, "chart values", event)
}

func writeHelmStreamEvent(w io.Writer, kind string, event any) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal Helm %s stream event: %w", kind, err)
	}
	_, err = fmt.Fprintf(w, "data: %s\n\n", payload)
	return err
}

// ---------- ArtifactHub proxy ----------

type ahSearchResult struct {
	Packages []json.RawMessage `json:"packages"`
}

type ahPackageDetail struct {
	ContentURL string `json:"content_url"`
}

func artifactHubContentURL(ctx context.Context, repository, chartName, version string) (string, error) {
	repository = strings.TrimSpace(repository)
	chartName = strings.TrimSpace(chartName)
	version = strings.TrimSpace(version)
	if repository == "" || chartName == "" {
		return "", nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	detailURL := fmt.Sprintf("https://artifacthub.io/api/v1/packages/helm/%s/%s", url.PathEscape(repository), url.PathEscape(chartName))
	if version != "" {
		detailURL += "/" + url.PathEscape(version)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, detailURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := proxypkg.HTTPClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ArtifactHub package detail returned HTTP %d", resp.StatusCode)
	}
	var detail ahPackageDetail
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		return "", err
	}
	contentURL := strings.TrimSpace(detail.ContentURL)
	if contentURL == "" {
		return "", nil
	}
	parsed, err := url.Parse(contentURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("ArtifactHub returned invalid content URL")
	}
	return contentURL, nil
}

func optionalArtifactHubContentURL(ctx context.Context, repository, chartName, version, repoURL string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(repoURL)), "oci://") {
		return ""
	}
	contentURL, err := artifactHubContentURL(ctx, repository, chartName, version)
	if err != nil {
		logs.Warn("resolve ArtifactHub content URL for %s/%s %s: %v", repository, chartName, version, err)
	}
	return contentURL
}

// SearchArtifactHub proxies a search to the ArtifactHub REST API.
// @router /api/search-artifact-hub [get]
func (c *ApiController) SearchArtifactHub() {
	if c.RequireSignedIn() {
		return
	}
	q := c.GetString("q")
	page, _ := c.GetInt("page", 1)
	limit, _ := c.GetInt("limit", 20)
	offset := (page - 1) * limit

	url := fmt.Sprintf(
		"https://artifacthub.io/api/v1/packages/search?kind=0&limit=%d&offset=%d",
		limit, offset,
	)
	if q != "" {
		url += "&ts_query_web=" + q
	}

	client := proxypkg.HTTPClient()
	ctx, cancel := context.WithTimeout(c.Ctx.Request.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}

	var result ahSearchResult
	if err := json.Unmarshal(body, &result); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(result.Packages)
}

// ---------- Custom repo CRUD (persisted via object/DB) ----------

// GetHelmRepos returns all persisted custom Helm repos.
// @router /api/get-helm-repos [get]
func (c *ApiController) GetHelmRepos() {
	if c.RequireSignedIn() {
		return
	}
	repos, err := object.GetHelmRepos()
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(repos)
}

// AddHelmRepo persists a new custom Helm repo.
// @router /api/add-helm-repo [post]
func (c *ApiController) AddHelmRepo() {
	if c.RequireAdmin() {
		return
	}
	var repo object.HelmRepo
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &repo); err != nil {
		c.ResponseError(err.Error())
		return
	}
	if err := object.AddHelmRepo(&repo); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}

// DeleteHelmRepo deletes a custom Helm repo by id.
// @router /api/delete-helm-repo [post]
func (c *ApiController) DeleteHelmRepo() {
	if c.RequireAdmin() {
		return
	}
	id, err := c.GetInt("id")
	if err != nil {
		c.ResponseError("invalid id")
		return
	}
	if err := object.DeleteHelmRepo(id); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}

// ---------- Repo index browsing (via store/Helm SDK) ----------

// GetRepoCharts fetches and returns a chart listing from a Helm repo's index.yaml.
// @router /api/get-repo-charts [get]
func (c *ApiController) GetRepoCharts() {
	if c.RequireSignedIn() {
		return
	}
	repoURL := c.GetString("url")
	if repoURL == "" {
		c.ResponseError("url is required")
		return
	}
	charts, err := store.FetchRepoIndex(repoURL)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(charts)
}

// ---------- Chart values (via store/Helm SDK) ----------

// GetHelmChartValues fetches the values.yaml shown in the App Store install dialog.
// @router /api/get-helm-chart-values [get]
func (c *ApiController) GetHelmChartValues() {
	if c.RequireSignedIn() {
		return
	}
	chartName := c.GetString("chart")
	repoURL := c.GetString("repo")
	version := c.GetString("version")
	artifactHubRepository := c.GetString("artifactHubRepository")
	if chartName == "" || repoURL == "" {
		c.ResponseError("chart and repo are required")
		return
	}
	contentURL := optionalArtifactHubContentURL(c.Ctx.Request.Context(), artifactHubRepository, chartName, version, repoURL)
	values, err := store.GetHelmChartInstallValuesWithFallbackContext(c.Ctx.Request.Context(), chartName, repoURL, version, contentURL)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(values)
}

// GetHelmChartValuesStream is GetHelmChartValues as Server-Sent Events, so the
// install dialog can show which artifact is downloading and how far along it is.
// @router /api/get-helm-chart-values-stream [get]
func (c *ApiController) GetHelmChartValuesStream() {
	if c.RequireSignedIn() {
		return
	}
	w := c.Ctx.ResponseWriter.ResponseWriter
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	chartName := c.GetString("chart")
	repoURL := c.GetString("repo")
	version := c.GetString("version")
	artifactHubRepository := c.GetString("artifactHubRepository")
	if chartName == "" || repoURL == "" {
		_ = writeHelmChartValuesStreamEvent(w, store.HelmChartValuesStreamEvent{
			Type:    store.HelmChartValuesStreamEventError,
			Message: "chart and repo are required",
		})
		c.StopRun()
		return
	}

	w.WriteHeader(http.StatusOK)
	responseController := http.NewResponseController(w)

	// Aborting the browser fetch ends the request context, which cancels the
	// download instead of leaving it to run to its two-minute timeout.
	contentURL := optionalArtifactHubContentURL(c.Ctx.Request.Context(), artifactHubRepository, chartName, version, repoURL)
	events := store.GetHelmChartInstallValuesStreamWithFallback(c.Ctx.Request.Context(), chartName, repoURL, version, contentURL)
	for event := range events {
		if err := writeHelmChartValuesStreamEvent(w, event); err != nil {
			break
		}
		if err := responseController.Flush(); err != nil {
			break
		}
	}
	c.StopRun()
}

// ---------- Release lifecycle (via store/Helm SDK) ----------

// GetHelmReleases lists installed Helm releases.
// @router /api/get-helm-releases [get]
func (c *ApiController) GetHelmReleases() {
	if c.RequireSignedIn() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("cluster not ready")
		return
	}
	namespace := c.GetString("namespace", "all")
	releases, err := store.GetHelmReleases(cfg, namespace)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(releases)
}

type helmInstallReq struct {
	ReleaseName        string `json:"releaseName"`
	Namespace          string `json:"namespace"`
	ChartName          string `json:"chartName"`
	RepoURL            string `json:"repoURL"`
	ArtifactHubRepo    string `json:"artifactHubRepository"`
	Version            string `json:"version"`
	ValuesYAML         string `json:"valuesYAML"`
	ValuesBaselineYAML string `json:"valuesBaselineYAML"`
}

// InstallHelmChart installs a new Helm release.
// @router /api/install-helm-chart [post]
func (c *ApiController) InstallHelmChart() {
	if c.RequireAdmin() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("cluster not ready")
		return
	}
	var req helmInstallReq
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError(err.Error())
		return
	}
	contentURL := optionalArtifactHubContentURL(c.Ctx.Request.Context(), req.ArtifactHubRepo, req.ChartName, req.Version, req.RepoURL)
	if err := store.InstallHelmChartWithValuesBaselineAndFallback(cfg, req.ReleaseName, req.Namespace, req.ChartName, req.RepoURL, req.Version, req.ValuesYAML, req.ValuesBaselineYAML, contentURL); err != nil {
		c.responseHelmError(err)
		return
	}
	c.ResponseOk()
}

type helmOperationStreamRunner func(context.Context, store.HelmInstallLifecycle, *rest.Config, helmInstallReq) <-chan store.HelmInstallStreamEvent

func (c *ApiController) streamHelmOperation(operation, actionLabel string, runner helmOperationStreamRunner) {
	if c.RequireAdmin() {
		return
	}
	w := c.Ctx.ResponseWriter.ResponseWriter
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	cfg := getAdminRestConfig()
	if cfg == nil {
		_ = writeHelmInstallStreamEvent(w, store.HelmInstallStreamEvent{Type: store.HelmInstallStreamEventError, Message: "cluster not ready"})
		c.StopRun()
		return
	}
	var req helmInstallReq
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		_ = writeHelmInstallStreamEvent(w, store.HelmInstallStreamEvent{Type: store.HelmInstallStreamEventError, Message: err.Error()})
		c.StopRun()
		return
	}
	owner := helmOperationOwner(c)
	if owner == "" {
		_ = writeHelmInstallStreamEvent(w, store.HelmInstallStreamEvent{Type: store.HelmInstallStreamEventError, Message: "unable to identify Helm operation owner"})
		c.StopRun()
		return
	}

	w.WriteHeader(http.StatusOK)

	ctx := c.Ctx.Request.Context()
	task, err := object.CreateHelmOperationTask(owner, operation, req.ReleaseName, req.Namespace, req.ChartName, req.RepoURL, req.Version)
	if err != nil {
		message := fmt.Sprintf("unable to start Helm %s", actionLabel)
		if errors.Is(err, object.ErrHelmOperationAlreadyActive) {
			message = err.Error()
		} else {
			logs.Error("create Helm operation task: %v", err)
		}
		_ = writeHelmInstallStreamEvent(w, store.HelmInstallStreamEvent{Type: store.HelmInstallStreamEventError, Message: message})
		c.StopRun()
		return
	}
	finishUnstartedTask := func(cause error) {
		finishCtx, cancel := context.WithTimeout(context.Background(), object.HelmOperationPersistenceTimeout)
		defer cancel()
		if finishErr := object.FinishHelmOperationTaskContext(finishCtx, task.Id, false, cause.Error()); finishErr != nil {
			logs.Error("finish unstarted Helm operation task %d: %v", task.Id, finishErr)
		}
	}
	if err := writeHelmInstallStreamEvent(w, store.HelmInstallStreamEvent{Type: store.HelmInstallStreamEventLog, Message: fmt.Sprintf("TASK_ID:%d", task.Id)}); err != nil {
		finishUnstartedTask(fmt.Errorf("failed to send Helm operation task id: %w", err))
		c.StopRun()
		return
	}
	responseController := http.NewResponseController(w)
	if err := responseController.Flush(); err != nil {
		finishUnstartedTask(fmt.Errorf("failed to flush Helm operation task id: %w", err))
		c.StopRun()
		return
	}
	recorder := object.NewHelmOperationRecorder(task.Id)
	logCh := runner(ctx, recorder, cfg, req)
	for event := range logCh {
		if err := writeHelmInstallStreamEvent(w, event); err != nil {
			break
		}
		if err := responseController.Flush(); err != nil {
			break
		}
	}
	c.StopRun()
}

// InstallHelmChartStream streams helm install progress as Server-Sent Events.
// @router /api/install-helm-chart-stream [post]
func (c *ApiController) InstallHelmChartStream() {
	c.streamHelmOperation(object.HelmOperationInstall, "installation", func(ctx context.Context, lifecycle store.HelmInstallLifecycle, cfg *rest.Config, req helmInstallReq) <-chan store.HelmInstallStreamEvent {
		contentURL := optionalArtifactHubContentURL(ctx, req.ArtifactHubRepo, req.ChartName, req.Version, req.RepoURL)
		return store.InstallHelmChartStreamWithValuesBaselineAndFallback(ctx, lifecycle, cfg, req.ReleaseName, req.Namespace, req.ChartName, req.RepoURL, req.Version, req.ValuesYAML, req.ValuesBaselineYAML, contentURL)
	})
}

// UpgradeHelmReleaseStream streams helm upgrade progress as Server-Sent Events.
// @router /api/upgrade-helm-release-stream [post]
func (c *ApiController) UpgradeHelmReleaseStream() {
	c.streamHelmOperation(object.HelmOperationUpgrade, "upgrade", func(ctx context.Context, lifecycle store.HelmInstallLifecycle, cfg *rest.Config, req helmInstallReq) <-chan store.HelmInstallStreamEvent {
		return store.UpgradeHelmReleaseStreamWithValuesBaseline(ctx, lifecycle, cfg, req.ReleaseName, req.Namespace, req.ChartName, req.RepoURL, req.Version, req.ValuesYAML, req.ValuesBaselineYAML)
	})
}

// GetHelmOperationTask returns a persisted Helm operation task and its log history so
// an administrator can reconnect after an SSE stream is interrupted.
// @router /api/get-helm-operation-task [get]
func (c *ApiController) GetHelmOperationTask() {
	if c.RequireAdmin() {
		return
	}
	id, err := strconv.ParseInt(c.GetString("id"), 10, 64)
	if err != nil || id <= 0 {
		c.ResponseError("invalid task id")
		return
	}
	owner := helmOperationOwner(c)
	if owner == "" {
		c.ResponseError("unable to identify Helm operation owner")
		return
	}
	task, err := object.GetHelmOperationTaskForOwner(id, owner)
	if err != nil {
		logs.Error("get Helm operation task %d: %v", id, err)
		c.ResponseError("failed to load Helm operation task")
		return
	}
	if task == nil {
		c.ResponseError("Helm operation task not found", helmOperationTaskNotFoundCode)
		return
	}
	taskLogs, err := object.GetHelmOperationLogs(id, 1000)
	if err != nil {
		logs.Error("get Helm operation task %d logs: %v", id, err)
		c.ResponseError("failed to load Helm operation task")
		return
	}
	c.ResponseOk(task, taskLogs)
}

// GetUnfinishedHelmInstalls lists the installs Helm has no release for yet, running or failed.
// @router /api/get-unfinished-helm-installs [get]
func (c *ApiController) GetUnfinishedHelmInstalls() {
	if c.RequireAdmin() {
		return
	}
	namespace := c.GetString("namespace")
	if namespace == "all" {
		namespace = ""
	}
	tasks, err := object.GetUnfinishedHelmInstalls(namespace)
	if err != nil {
		logs.Error("get unfinished Helm installs: %v", err)
		c.ResponseError("failed to load Helm operation tasks")
		return
	}
	c.ResponseOk(tasks)
}

// DeleteHelmOperationTask removes a finished task, so a failed install leaves the apps list.
// @router /api/delete-helm-operation-task [post]
func (c *ApiController) DeleteHelmOperationTask() {
	if c.RequireAdmin() {
		return
	}
	var req struct {
		Id int64 `json:"id"`
	}
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil || req.Id <= 0 {
		c.ResponseError("invalid task id")
		return
	}
	if err := object.DeleteFinishedHelmOperationTask(req.Id); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}

// GetHelmReleaseOperation returns the most recent Helm operation recorded for a
// release, with its log history, so the Helm Releases page can answer why a
// release is still pending instead of showing a status with no explanation.
// A release CasOS never operated on answers with a null task rather than an
// error, because "no logs were recorded" is an answer.
// @router /api/get-helm-release-operation [get]
func (c *ApiController) GetHelmReleaseOperation() {
	if c.RequireAdmin() {
		return
	}
	namespace := strings.TrimSpace(c.GetString("namespace"))
	name := strings.TrimSpace(c.GetString("name"))
	if namespace == "" || name == "" {
		c.ResponseError("name and namespace are required")
		return
	}
	task, err := object.GetLatestHelmOperationTaskForRelease(namespace, name)
	if err != nil {
		logs.Error("get Helm operation task for %s/%s: %v", namespace, name, err)
		c.ResponseError("failed to load Helm operation task")
		return
	}
	if task == nil {
		c.ResponseOk(nil, []*object.HelmOperationLog{})
		return
	}
	taskLogs, err := object.GetHelmOperationLogs(task.Id, 1000)
	if err != nil {
		logs.Error("get Helm operation task %d logs: %v", task.Id, err)
		c.ResponseError("failed to load Helm operation task")
		return
	}
	c.ResponseOk(task, taskLogs)
}

func helmOperationOwner(c *ApiController) string {
	if user := c.GetSessionUser(); user != nil {
		return canonicalHelmOperationOwner(user.Id, user.Owner, user.Name)
	}
	return ""
}

func canonicalHelmOperationOwner(id, owner, name string) string {
	if id = strings.TrimSpace(id); id != "" {
		return id
	}
	owner = strings.TrimSpace(owner)
	name = strings.TrimSpace(name)
	if owner == "" || name == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(owner + "\x00" + name))
	return fmt.Sprintf("casdoor:%x", digest)
}

// UpgradeHelmRelease upgrades an existing Helm release.
// @router /api/upgrade-helm-release [post]
func (c *ApiController) UpgradeHelmRelease() {
	if c.RequireAdmin() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("cluster not ready")
		return
	}
	var req helmInstallReq
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError(err.Error())
		return
	}
	if err := store.UpgradeHelmReleaseWithValuesBaseline(cfg, req.ReleaseName, req.Namespace, req.ChartName, req.RepoURL, req.Version, req.ValuesYAML, req.ValuesBaselineYAML); err != nil {
		c.responseHelmError(err)
		return
	}
	c.ResponseOk()
}

type helmRollbackReq struct {
	ReleaseName string `json:"releaseName"`
	Namespace   string `json:"namespace"`
	Revision    int    `json:"revision"`
}

// RollbackHelmRelease rolls back a Helm release to a previous revision.
// @router /api/rollback-helm-release [post]
func (c *ApiController) RollbackHelmRelease() {
	if c.RequireAdmin() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("cluster not ready")
		return
	}
	var req helmRollbackReq
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError(err.Error())
		return
	}
	if err := store.RollbackHelmRelease(cfg, req.ReleaseName, req.Namespace, req.Revision); err != nil {
		c.responseHelmError(err)
		return
	}
	c.ResponseOk()
}

type helmUninstallReq struct {
	ReleaseName string `json:"releaseName"`
	Namespace   string `json:"namespace"`
	DeleteData  bool   `json:"deleteData"`
}

// UninstallHelmRelease removes a Helm release from the cluster.
// @router /api/uninstall-helm-release [post]
func (c *ApiController) UninstallHelmRelease() {
	if c.RequireAdmin() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("cluster not ready")
		return
	}
	var req helmUninstallReq
	if err := json.Unmarshal(c.Ctx.Input.RequestBody, &req); err != nil {
		c.ResponseError(err.Error())
		return
	}
	if err := store.UninstallHelmReleaseWithOptions(cfg, req.ReleaseName, req.Namespace, req.DeleteData); err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk()
}

// GetHelmReleaseHistory returns the revision history of a release.
// @router /api/get-helm-release-history [get]
func (c *ApiController) GetHelmReleaseHistory() {
	if c.RequireSignedIn() {
		return
	}
	cfg := getAdminRestConfig()
	if cfg == nil {
		c.ResponseError("cluster not ready")
		return
	}
	name := c.GetString("name")
	namespace := c.GetString("namespace")
	if name == "" || namespace == "" {
		c.ResponseError("name and namespace are required")
		return
	}
	history, err := store.GetHelmReleaseHistory(cfg, name, namespace)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	c.ResponseOk(history)
}
