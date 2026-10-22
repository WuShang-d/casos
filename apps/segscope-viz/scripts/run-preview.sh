#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export SEGSCOPE_ADDR="${SEGSCOPE_ADDR:-127.0.0.1:5175}"
export SEGSCOPE_STATIC_DIR="${SEGSCOPE_STATIC_DIR:-$PWD/build}"
exec ./segscope-viz
