#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/local/go/bin:$PATH"
export GOMAXPROCS=2
export GOFLAGS='-p=2'
export NODE_OPTIONS=--max-old-space-size=1536
python3 scripts/build-runner.py
node scripts/check-imports.mjs
node scripts/check-channel-imports.mjs
python3 scripts/check-channel.py
yarn install --frozen-lockfile --non-interactive
yarn build
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o thermalscope ./server
go vet ./server
python3 scripts/package-image.py
cp marketplace/thermalscope/index.yaml release/marketplace-template.yaml
tar --exclude=.DS_Store -czf release/thermalscope-chart-0.1.0.tgz -C . chart
printf 'Release built locally on this host. Nothing has been pushed.\n'
