package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/casosorg/casos/proxy"
)

type namespaceInfo struct {
	GravatarURL string `json:"gravatar_url"`
}

// fetchNamespaceGravatar tries the orgs then users endpoint for a Docker Hub namespace.
// Returns the gravatar_url with d=404 so callers can detect missing avatars via HTTP 404.
func fetchNamespaceGravatar(namespace string) string {
	for _, kind := range []string{"orgs", "users"} {
		apiURL := fmt.Sprintf("https://hub.docker.com/v2/%s/%s/", kind, namespace)
		resp, err := proxy.GetHttpClient(apiURL).Get(apiURL)
		if err != nil {
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil || resp.StatusCode != 200 {
			continue
		}
		var info namespaceInfo
		if json.Unmarshal(body, &info) == nil && info.GravatarURL != "" {
			return strings.ReplaceAll(info.GravatarURL, "d=mm", "d=404")
		}
	}
	return ""
}

// FetchNamespaceLogos concurrently fetches gravatar URLs for a set of Docker Hub namespaces.
// Returns a map of namespace -> gravatar URL (empty string if not found).
func FetchNamespaceLogos(namespaces []string) map[string]string {
	result := make(map[string]string, len(namespaces))
	if len(namespaces) == 0 {
		return result
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, ns := range namespaces {
		wg.Add(1)
		go func(ns string) {
			defer wg.Done()
			logo := fetchNamespaceGravatar(ns)
			mu.Lock()
			result[ns] = logo
			mu.Unlock()
		}(ns)
	}
	wg.Wait()
	return result
}

// extractNamespace returns the namespace portion of a Docker Hub repo name.
// Official images (no slash) return an empty string.
func extractNamespace(repoName string) string {
	if idx := strings.Index(repoName, "/"); idx != -1 {
		return repoName[:idx]
	}
	return ""
}

// uniqueNamespaces extracts deduplicated non-empty namespaces from a list of repo names.
func uniqueNamespaces(repoNames []string) []string {
	seen := make(map[string]struct{})
	var result []string
	for _, name := range repoNames {
		ns := extractNamespace(name)
		if ns == "" {
			continue
		}
		if _, ok := seen[ns]; !ok {
			seen[ns] = struct{}{}
			result = append(result, ns)
		}
	}
	return result
}
