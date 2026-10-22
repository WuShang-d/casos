#!/usr/bin/env bash
set -euo pipefail
umask 077
work=$(cd "$(dirname "$0")" && pwd)
cd "$work"
trap 'trap - TERM INT HUP; kill -TERM -- "-$(cat "$work/.pgid")" 2>/dev/null || true; exit 143' TERM INT HUP
phase() { printf '@@phase %s\n' "$1"; }
fail() { printf '检查未能完成：%s\n' "$1"; exit 1; }
[[ $(id -u) -ne 0 ]] || fail '请使用普通账号运行自动检查，工具不会以管理员身份改动电脑。'
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail '自动检查目前需要 x86_64 Linux。'
case "${1:-}" in E1|E3|E4) experiment=$1 ;; *) fail '这项检查暂不支持自动运行。' ;; esac
for tool in python3 gcc timeout taskset; do command -v "$tool" >/dev/null || fail "缺少所需工具：$tool"; done
# These limits apply only to this task and descendants.
if [[ ${SEGSCOPE_SCOPED:-0} != 1 ]] && command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet --collect -p MemoryMax=4G /bin/true >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet --collect --unit="segscope-$(basename "$work")" -p MemoryMax=4G -p CPUQuota=100% -p TasksMax=128 env SEGSCOPE_SCOPED=1 bash "$work/runner.sh" "$experiment"
fi
if [[ $experiment == E1 && ${SEGSCOPE_SCOPED:-0} != 1 ]]; then
  fail '浏览器检查需要普通账号可用的内存和处理器资源限额；当前环境未提供，未启动浏览器。'
fi
if [[ $experiment != E1 ]]; then ulimit -v 4194304; fi
ulimit -f 524288
ulimit -c 0
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 MAKEFLAGS=-j1 CMAKE_BUILD_PARALLEL_LEVEL=1
cpu=$(python3 -c 'import os; print(max(os.sched_getaffinity(0)))')
export SEGSCOPE_CPU="$cpu"
printf '使用处理器编号 %s；低优先级、单任务运行，最多 4 GiB 内存。\n' "$cpu"
mkdir -p results
phase preparing
case "$experiment" in
  E1)
    cache_key=$(sha256sum requirements.txt | cut -d' ' -f1)
    runtime="$HOME/.cache/segscope-viz/runtime/$cache_key"
    mkdir -p "$runtime" "$work/tmp"
    export TMPDIR="$work/tmp" PLAYWRIGHT_BROWSERS_PATH="$runtime/browsers"
    command -v flock >/dev/null || fail '缺少独立环境安装所需的文件锁工具。'
    exec 9>"$runtime/install.lock"
    flock -w 60 9 || fail '另一项安装正在准备运行环境，请稍后再试。'
    if [[ ! -f "$runtime/ready" ]]; then
      python3 -m venv "$runtime/venv" || fail '无法建立独立运行环境，请管理员预先提供 Python venv 支持。'
      "$runtime/venv/bin/python" -m pip --isolated --cache-dir "$runtime/pip-cache" install --disable-pip-version-check --no-input --retries 1 --timeout 30 -r requirements.txt
      "$runtime/venv/bin/python" -m playwright install chromium
      touch "$runtime/ready"
    fi
    flock -u 9
    ln -s "$runtime/venv" .venv
    phase running
    taskset -c "$cpu" .venv/bin/python -u e1.py
    ;;
  E3)
    python3 - <<'PY'
from pathlib import Path
import os
p=Path('upstream/E3-Breaking_KASLR/main.c')
s=p.read_text().replace('CPU_SET(3, &mask)', f'CPU_SET({int(os.environ["SEGSCOPE_CPU"])}, &mask)')
Path('measure.c').write_text(s)
PY
    gcc measure.c -lpthread -lm -O3 -o measure
    phase running
    timeout --kill-after=5 90 taskset -c "$cpu" ./measure 2 p
    cp result-512 results/result-512
    python3 - <<'PY'
from pathlib import Path
import json,math,os
p=Path('results/result-512'); values=[float(x) for x in p.read_text().splitlines()]
assert len(values)==512 and all(math.isfinite(x) and x>=0 for x in values), '测量未返回完整的512个位置'
Path('results/metadata.json').write_text(json.dumps({'experiment':'E3','mode':'prefetch','cycles':2,'cpu':int(os.environ['SEGSCOPE_CPU']),'truthProvided':False,'note':'短时预取测量；分数不是CPU周期，未读取受限真值'},ensure_ascii=False))
PY
    ;;
  E4)
    for tool in clang-18 opt-18 cmake; do command -v "$tool" >/dev/null || fail "缺少所需工具：$tool"; done
    llvm_config=$(find /usr/lib/llvm-18 /usr/local/lib/llvm-18 -name LLVMConfig.cmake -print -quit 2>/dev/null || true)
    [[ -n "$llvm_config" ]] || fail '未找到 LLVM 18 开发组件；不会自动修改系统软件包。'
    cmake -S upstream/E4-Interrupt_Detection -B llvm-build -DLLVM_DIR="$(dirname "$llvm_config")" -DCMAKE_BUILD_TYPE=Release
    cmake --build llvm-build --parallel 1
    phase running
    taskset -c "$cpu" python3 -u e4.py
    ;;
esac
phase collecting
printf '检查完成，正在返回记录。\n'
