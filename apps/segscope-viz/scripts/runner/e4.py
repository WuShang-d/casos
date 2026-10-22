import csv
import json
import statistics
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
runtime = root / 'upstream/E4-Interrupt_Detection/runtime/intmon_runtime.c'
plugin = root / 'llvm-build/AutoInstrumentPass.so'

def call(args):
    subprocess.run([str(a) for a in args], check=True, timeout=120)

call(['clang-18', '-O0', '-g', '-emit-llvm', '-c', 'e4-benchmark.c', '-o', 'benchmark.bc'])
call(['clang-18', '-O0', 'benchmark.bc', '-o', 'baseline'])
rows = []
for mode in ['once', 'branch', 'block']:
    print(f'正在比较保护设置：{mode}', flush=True)
    call(['opt-18', '-load-pass-plugin', plugin, '-passes=intmon-branch', '-instrument-mode=secret', '-secret-args=work:0', f'-secret-instrument={mode}', 'benchmark.bc', '-o', f'{mode}.bc'])
    call(['clang-18', '-O0', f'{mode}.bc', runtime, '-o', mode])
    baseline, instrumented = [], []
    for repeat in range(5):
        values = []
        for executable in ['baseline', mode]:
            result = subprocess.run([str(root/executable)], check=True, capture_output=True, text=True, timeout=20)
            ns, digest = map(int, result.stdout.strip().split())
            if ns <= 0:
                raise RuntimeError('测量时间无效')
            values.append((ns, digest))
        if values[0][1] != values[1][1]:
            raise RuntimeError('加入保护后程序输出发生变化，不能将其作为有效性能比较')
        baseline.append(values[0][0]); instrumented.append(values[1][0])
    base, inst = statistics.median(baseline), statistics.median(instrumented)
    rows.append({'case': 'branch-loop-quick-check', 'library': 'SegScope quick benchmark', 'version': '0.3.0', 'algorithm': 'integer-branch-loop', 'instrument_mode': mode, 'ipi_mode': 'none', 'iterations': 5, 'rc': 0, 'rc_base': 0, 'bin_size_base': (root/'baseline').stat().st_size, 'bin_size_inst': (root/mode).stat().st_size, 'overhead_pct': f'{(inst/base-1)*100:.4f}', 'func_overhead_pct': '-', 'total_time': inst, 'base_total_time': base, 'time_unit': 'ns'})
with (root/'results/known_cases_results.tsv').open('w') as output:
    writer = csv.DictWriter(output, fieldnames=list(rows[0]), delimiter='\t'); writer.writeheader(); writer.writerows(rows)
(root/'results/metadata.json').write_text(json.dumps({'experiment': 'E4', 'mode': 'no-kernel-module-quick-benchmark', 'repetitions': 5, 'statistic': 'median', 'note': '使用原LLVM防护插件的轻量分支循环基准；不加载内核模块，不主动注入干扰，不代表完整密码库矩阵或防护有效性验证'}, ensure_ascii=False))
