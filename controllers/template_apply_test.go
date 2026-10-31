package controllers

import "testing"

func TestStripMissingImagePullSecrets(t *testing.T) {
	exists := func(name string) bool { return name == "kept" }

	t.Run("drops a secret the namespace does not have", func(t *testing.T) {
		pod := map[string]any{
			"spec": map[string]any{
				"imagePullSecrets": []any{
					map[string]any{"name": "chrome-abc123"},
				},
			},
		}
		stripMissingImagePullSecrets(pod, exists)
		spec := pod["spec"].(map[string]any)
		if _, found := spec["imagePullSecrets"]; found {
			t.Fatalf("missing pull secret was kept: %#v", spec["imagePullSecrets"])
		}
	})

	t.Run("keeps a secret that exists", func(t *testing.T) {
		pod := map[string]any{
			"spec": map[string]any{
				"imagePullSecrets": []any{
					map[string]any{"name": "kept"},
					map[string]any{"name": "missing"},
				},
			},
		}
		stripMissingImagePullSecrets(pod, exists)
		spec := pod["spec"].(map[string]any)
		refs, _ := spec["imagePullSecrets"].([]any)
		if len(refs) != 1 {
			t.Fatalf("got %#v, want only the existing secret", refs)
		}
		if refs[0].(map[string]any)["name"] != "kept" {
			t.Fatalf("got %#v", refs[0])
		}
	})

	t.Run("walks a nested pod template", func(t *testing.T) {
		set := map[string]any{
			"spec": map[string]any{
				"template": map[string]any{
					"spec": map[string]any{
						"imagePullSecrets": []any{map[string]any{"name": "chrome-abc123"}},
					},
				},
			},
		}
		stripMissingImagePullSecrets(set, exists)
		spec := set["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
		if _, found := spec["imagePullSecrets"]; found {
			t.Fatalf("nested pull secret was kept: %#v", spec["imagePullSecrets"])
		}
	})
}
