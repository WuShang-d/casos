#!/usr/bin/env bash
set -euo pipefail
umask 077
work=$(cd "$(dirname "$0")" && pwd)
cd "$work"
mode=${1:-}
case "$mode" in thermal|channel) ;; *) echo '不支持的实验。'; exit 1;; esac
quota=25%
[[ $mode != channel ]] || quota=75%
[[ $(id -u) -ne 0 ]] || { echo '请使用普通账号运行记录。'; exit 1; }
command -v python3 >/dev/null || { echo '没有找到 Python 3，请先准备后重试。'; exit 1; }
if [[ ${THERMALSCOPE_SCOPED:-0} != 1 ]] && command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet --collect -p MemoryMax=128M /bin/true >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet --collect --unit="thermalscope-$(basename "$work")" -p MemoryMax=128M -p CPUQuota="$quota" -p TasksMax=16 env THERMALSCOPE_SCOPED=1 bash "$work/runner.sh" "$mode"
fi
ulimit -v 131072
ulimit -f 8192
ulimit -c 0
printf '@@phase preparing\n'
if [[ $mode == channel ]]; then exec python3 -u channel.py; fi
exec python3 -u sample.py
