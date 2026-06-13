package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var dockerHubClient = &http.Client{Timeout: 8 * time.Second}

type dockerHubSearchResult struct {
	Count   int               `json:"count"`
	Results []dockerHubImage  `json:"results"`
}

type dockerHubImage struct {
	Name        string `json:"name"`
	Description string `json:"short_description"`
	IsOfficial  bool   `json:"is_official"`
	PullCount   int64  `json:"pull_count"`
	StarCount   int    `json:"star_count"`
}

type ImageSearchItem struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsOfficial  bool   `json:"isOfficial"`
	PullCount   int64  `json:"pullCount"`
	StarCount   int    `json:"starCount"`
}

func (c *ApiController) SearchDockerHubImages() {
	q := strings.TrimSpace(c.GetString("q"))
	if q == "" {
		c.ResponseError("query parameter 'q' is required")
		return
	}

	apiURL := fmt.Sprintf(
		"https://hub.docker.com/v2/search/repositories/?query=%s&page_size=20&page=1",
		url.QueryEscape(q),
	)

	resp, err := dockerHubClient.Get(apiURL)
	if err != nil {
		c.ResponseError(fmt.Sprintf("failed to reach Docker Hub: %v", err))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.ResponseError("failed to read Docker Hub response")
		return
	}

	var result dockerHubSearchResult
	if err := json.Unmarshal(body, &result); err != nil {
		c.ResponseError("failed to parse Docker Hub response")
		return
	}

	items := make([]ImageSearchItem, 0, len(result.Results))
	for _, r := range result.Results {
		items = append(items, ImageSearchItem{
			Name:        r.Name,
			Description: r.Description,
			IsOfficial:  r.IsOfficial,
			PullCount:   r.PullCount,
			StarCount:   r.StarCount,
		})
	}

	c.ResponseOk(items)
}
