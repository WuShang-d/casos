#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
image=${1:?Usage: scripts/package-release.sh registry/namespace/segscope-viz:version}
for tool in python3 yarn go docker helm; do command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }; done
python3 scripts/build-runner.py
node scripts/check-imports.mjs
helm lint chart
docker build -t "$image" .
mkdir -p release
helm package chart --destination release
cp marketplace/segscope-viz/index.yaml release/marketplace-template.yaml
printf 'Built %s and release/segscope-viz-0.3.0.tgz. Nothing has been pushed or published.\n' "$image"
