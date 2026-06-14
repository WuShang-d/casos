package util

import (
	"os"
	"path/filepath"
)

func ReadStringFromPath(path string) string {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		panic(err)
	}
	return string(data)
}

func WriteStringToPath(s string, path string) {
	err := os.WriteFile(path, []byte(s), 0o644)
	if err != nil {
		panic(err)
	}
}
