// Copyright 2026 The Casos Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package i18n

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

// DuplicateInfo represents information about a duplicate key
type DuplicateInfo struct {
	Key          string
	OldPrefix    string
	NewPrefix    string
	OldPrefixKey string // e.g., "general:Cancel"
	NewPrefixKey string // e.g., "permission:Cancel"
}

// findDuplicateKeysInJSON finds duplicate keys across the entire JSON file
// Returns a list of duplicate information showing old and new prefix:key pairs
// The order is determined by the order keys appear in the JSON file (git history)
func findDuplicateKeysInJSON(filePath string) ([]DuplicateInfo, error) {
	fileContent, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", filePath, err)
	}

	keyFirstPrefix := make(map[string]string)
	var duplicates []DuplicateInfo

	decoder := json.NewDecoder(bytes.NewReader(fileContent))

	token, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("failed to read token: %w", err)
	}
	if delim, ok := token.(json.Delim); !ok || delim != '{' {
		return nil, fmt.Errorf("expected object start, got %v", token)
	}

	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("failed to read namespace: %w", err)
		}

		prefix, ok := token.(string)
		if !ok {
			return nil, fmt.Errorf("expected string namespace, got %v", token)
		}

		var namespaceData map[string]string
		if err := decoder.Decode(&namespaceData); err != nil {
			return nil, fmt.Errorf("failed to decode namespace %s: %w", prefix, err)
		}

		for key := range namespaceData {
			if firstPrefix, exists := keyFirstPrefix[key]; exists {
				duplicates = append(duplicates, DuplicateInfo{
					Key:          key,
					OldPrefix:    firstPrefix,
					NewPrefix:    prefix,
					OldPrefixKey: fmt.Sprintf("%s:%s", firstPrefix, key),
					NewPrefixKey: fmt.Sprintf("%s:%s", prefix, key),
				})
			} else {
				keyFirstPrefix[key] = prefix
			}
		}
	}

	return duplicates, nil
}
