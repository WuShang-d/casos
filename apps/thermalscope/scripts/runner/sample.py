#!/usr/bin/env python3
import datetime
import glob
import json
import math
import os
from pathlib import Path
import platform
import re
import time


def read_number(path):
    try:
        text = Path(path).read_text()[:64].strip()
        if not re.fullmatch(r'-?\d+', text):
            return None
        return int(text)
    except (OSError, ValueError):
        return None


def read_text(path, fallback):
    try:
        return Path(path).read_text()[:100].strip() or fallback
    except OSError:
        return fallback


def read_trm(path='/proc/interrupts'):
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return {}
    cpus = []
    for line in lines:
        if not cpus:
            cpus = re.findall(r'\bCPU(\d+)\b', line)
        if re.match(r'^\s*TRM:', line):
            values = line.split(':', 1)[1].split()
            return {cpu: int(value) for cpu, value in zip(cpus, values) if value.isdigit()}
    return {}


def discover():
    sources = []
    for path in sorted(glob.glob('/sys/class/hwmon/hwmon*/temp*_input')):
        if read_number(path) is None:
            continue
        p = Path(path)
        driver = read_text(p.parent/'name', p.parent.name)
        label = read_text(p.with_name(p.name.replace('_input', '_label')), p.stem)
        sources.append({'id': f'temp-{len(sources)}', 'label': f'{driver} · {label}', 'kind': 'temperature', 'unit': '°C', 'path': path})
        if len(sources) >= 24:
            break
    cpus = sorted(os.sched_getaffinity(0))[:8]
    packages = set()
    for cpu in cpus:
        for counter in ('core_throttle_count', 'package_throttle_count'):
            path = f'/sys/devices/system/cpu/cpu{cpu}/thermal_throttle/{counter}'
            if read_number(path) is None:
                continue
            if counter.startswith('package'):
                package = read_text(f'/sys/devices/system/cpu/cpu{cpu}/topology/physical_package_id', 'unknown')
                if package in packages:
                    continue
                packages.add(package)
                label = f'处理器组 {package} · 节流计数'
            else:
                label = f'CPU {cpu} · 核心节流计数'
            sources.append({'id': f'throttle-{cpu}-{counter}', 'label': label, 'kind': 'throttle', 'unit': 'events/interval', 'path': path})
    trm = read_trm()
    for cpu in cpus:
        if str(cpu) in trm:
            sources.append({'id': f'trm-{cpu}', 'label': f'CPU {cpu} · 热中断', 'kind': 'trm', 'unit': 'events/interval', 'path': '/proc/interrupts#TRM', 'cpu': str(cpu)})
    return sources


def sample(sources, duration=60, interval=1, reader=None, now=time.monotonic, sleep=time.sleep):
    previous, samples, resets = {}, [], []
    start = now()
    reader = reader or (lambda source, trm: trm.get(source.get('cpu')) if source['kind'] == 'trm' else read_number(source['path']))
    for index in range(int(duration / interval) + 1):
        delay = start + index * interval - now()
        if delay > 0:
            sleep(delay)
        trm = read_trm() if any(s['kind'] == 'trm' for s in sources) else {}
        values = {}
        elapsed = now() - start
        for source in sources:
            value = reader(source, trm)
            if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
                previous.pop(source['id'], None)
                values[source['id']] = None
            elif source['kind'] == 'temperature':
                values[source['id']] = value / 1000
            elif value < 0:
                previous.pop(source['id'], None)
                values[source['id']] = None
            else:
                old = previous.get(source['id'])
                previous[source['id']] = value
                values[source['id']] = value - old if old is not None and value >= old else None
                if old is not None and value < old:
                    resets.append({'sourceId': source['id'], 'seconds': elapsed})
        samples.append({'seconds': elapsed, 'values': values})
        if index % 10 == 0:
            print(f'已记录 {min(index * interval, duration):g} / {duration:g} 秒', flush=True)
    return samples, resets


def main():
    if os.geteuid() == 0:
        raise SystemExit('请使用普通账号，自动记录不需要管理员权限。')
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('自动记录需要 x86_64 Linux，已有记录仍可导入分析。')
    cpuinfo = Path('/proc/cpuinfo').read_text()
    if not re.search(r'vendor_id\s*:\s*GenuineIntel', cpuinfo):
        raise SystemExit('当前采集范围为 Intel Linux，未启动其他平台的实验。')
    sources = discover()
    if not sources:
        raise SystemExit('没有找到可读取的温度、热中断或节流计数；未生成测量结果。')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print('@@phase running', flush=True)
    print(f'被动读取 {len(sources)} 个现有来源，不执行加热负载或修改系统设置。', flush=True)
    samples, resets = sample(sources)
    if not any(value is not None for row in samples for value in row['values'].values()):
        raise SystemExit('采样来源均不可读，未生成有效结果。')
    notes = ['仅记录此时已有活动，不能单独证明隐蔽信道、模型识别或位置推测有效。']
    if not any(s['kind'] == 'trm' for s in sources):
        notes.append('未暴露可读取的 TRM 热中断记录；节流计数和温度不能替代该记录。')
    if resets:
        notes.append('检测到计数器回退，对应采样点标为空值，未将回退视为事件。')
    result = {'version': 1, 'source': 'thermal-observation', 'startedAt': started, 'durationSeconds': 60, 'intervalSeconds': 1, 'sources': sources, 'samples': samples, 'resets': resets, 'notes': notes}
    output = Path('results')
    output.mkdir(exist_ok=True)
    for name, value in [('thermal-trace.json', result), ('metadata.json', {'experiment': 'thermal', 'mode': 'passive-observation', 'startedAt': started, 'durationSeconds': 60, 'intervalSeconds': 1, 'sourceCount': len(sources), 'notes': notes})]:
        tmp = output/(name+'.tmp')
        tmp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n')
        tmp.replace(output/name)
    print('@@phase collecting', flush=True)


if __name__ == '__main__':
    main()
