#!/usr/bin/env python3
import datetime
import glob
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import time
import selectors


SLOT_SECONDS = 6
PREAMBLE = '0101'
MAX_PAYLOAD_BITS = 8
MAX_TEMPERATURE_C = 80
DUTY_CYCLE = 0.5
BUSY_MS = 20
SLEEP_MS = 20
SAMPLE_INTERVAL = 0.2
STARTUP_DELAY = 1.0
TIMEOUT_SECONDS = 110


def read_number(path):
    try:
        text = Path(path).read_text()[:64].strip()
        if not re.fullmatch(r'-?\d+', text):
            return None
        return int(text)
    except (OSError, ValueError):
        return None


def read_text(path, fallback=''):
    try:
        return Path(path).read_text()[:256].strip() or fallback
    except OSError:
        return fallback


def validate_environment():
    if os.geteuid() == 0:
        raise SystemExit('请使用普通用户运行，不需要管理员权限。')
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('需要 Linux x86_64 平台。')
    cpuinfo = Path('/proc/cpuinfo').read_text()
    if not re.search(r'vendor_id\s*:\s*GenuineIntel', cpuinfo):
        raise SystemExit('仅支持 GenuineIntel 处理器。')
    virt = None
    try:
        result = subprocess.run(['systemd-detect-virt'], capture_output=True, text=True, timeout=2)
        if result.returncode == 0:
            virt = result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    if virt and virt not in ('none', ''):
        raise SystemExit(f'检测到虚拟化环境 ({virt})，不支持热传导实验。')


def discover_topology():
    cpus = []
    for cpu_dir in sorted(glob.glob('/sys/devices/system/cpu/cpu[0-9]*')):
        match = re.search(r'cpu(\d+)$', cpu_dir)
        if not match:
            continue
        cpu_id = int(match.group(1))
        if cpu_id not in os.sched_getaffinity(0):
            continue
        pkg = read_text(f'{cpu_dir}/topology/physical_package_id', '')
        core = read_text(f'{cpu_dir}/topology/core_id', '')
        if not pkg or not core:
            continue
        cpus.append({'cpu': cpu_id, 'package': pkg, 'core': core})
    return cpus


def find_socket_sensor(socket_id):
    pattern = '/sys/class/hwmon/hwmon*/temp*_label'
    for label_path in sorted(glob.glob(pattern)):
        label = read_text(label_path, '')
        if read_text(Path(label_path).parent / 'name') == 'coretemp' and label == f'Package id {socket_id}':
            input_path = label_path.replace('_label', '_input')
            if read_number(input_path) is not None:
                return input_path, label
    return None, None


def select_cores(topology):
    sockets = {}
    for entry in topology:
        pkg = entry['package']
        if pkg not in sockets:
            sockets[pkg] = []
        sockets[pkg].append(entry)
    for pkg, cores in sockets.items():
        unique_cores = {}
        for c in cores:
            key = c['core']
            if key not in unique_cores:
                unique_cores[key] = c
        if len(unique_cores) >= 2:
            selected = list(unique_cores.values())[:2]
            return selected[0]['cpu'], selected[1]['cpu'], pkg
    return None, None, None


def validate_bits(bits):
    if not isinstance(bits, str):
        return False
    if len(bits) < 1 or len(bits) > MAX_PAYLOAD_BITS:
        return False
    if not re.fullmatch(r'[01]+', bits):
        return False
    return True


def read_temperature(path):
    value = read_number(path)
    if value is None:
        return None
    return value / 1000.0


def check_safety(sensor_path):
    temp = read_temperature(sensor_path)
    if temp is None or not math.isfinite(temp) or temp < 0:
        return False, '传感器不可读'
    if temp >= MAX_TEMPERATURE_C:
        return False, f'温度 {temp:.1f}°C 超过安全上限 {MAX_TEMPERATURE_C}°C'
    return True, None


def decode(samples, payload_length, slot_seconds=SLOT_SECONDS, preamble=PREAMBLE):
    total_slots = len(preamble) + payload_length
    slot_data = [[] for _ in range(total_slots)]
    slot_times = [[] for _ in range(total_slots)]
    for sample in samples:
        sec = sample.get('seconds')
        temp = sample.get('temperatureC')
        if (not isinstance(sec, (int, float)) or not math.isfinite(sec) or sec < 0
                or not isinstance(temp, (int, float)) or not math.isfinite(temp) or temp < 0):
            continue
        slot_idx = int(sec // slot_seconds)
        if 0 <= slot_idx < total_slots:
            half = slot_seconds / 2
            if sec >= slot_idx * slot_seconds + half:
                slot_data[slot_idx].append(temp)
                slot_times[slot_idx].append(sec)
    slot_means = []
    for idx, temps in enumerate(slot_data):
        times = slot_times[idx]
        window_start = (idx + .5) * slot_seconds
        window_end = (idx + 1) * slot_seconds
        covered = (len(times) >= 8 and times[0] - window_start <= .6
                   and window_end - times[-1] <= .6
                   and all(0 < b - a <= .6 for a, b in zip(times, times[1:])))
        if covered:
            slot_means.append(sum(temps) / len(temps))
        else:
            slot_means.append(None)
    zero_means = []
    one_means = []
    for idx, bit in enumerate(preamble):
        mean = slot_means[idx]
        if mean is None:
            continue
        if bit == '0':
            zero_means.append(mean)
        else:
            one_means.append(mean)
    calibration_valid = False
    zero_mean = None
    one_mean = None
    threshold = None
    separation = None
    if len(zero_means) == preamble.count("0") and len(one_means) == preamble.count("1"):
        zero_mean = sum(zero_means) / len(zero_means)
        one_mean = sum(one_means) / len(one_means)
        separation = one_mean - zero_mean
        min_one = min(one_means)
        max_zero = max(zero_means)
        if separation >= 0.5 and min_one - max_zero >= .25:
            calibration_valid = True
            threshold = (zero_mean + one_mean) / 2
    received = []
    slots_out = []
    for idx in range(len(preamble)):
        bit_char = preamble[idx]
        mean = slot_means[idx]
        slots_out.append({
            'index': idx,
            'phase': 'calibration',
            'meanC': mean,
            'bit': bit_char if mean is not None else '?',
            'samples': len(slot_data[idx])
        })
    for i in range(payload_length):
        slot_idx = len(preamble) + i
        mean = slot_means[slot_idx]
        if not calibration_valid or mean is None:
            bit = '?'
        elif mean >= threshold:
            bit = '1'
        else:
            bit = '0'
        received.append(bit)
        slots_out.append({
            'index': slot_idx,
            'phase': 'payload',
            'meanC': mean,
            'bit': bit,
            'samples': len(slot_data[slot_idx])
        })
    received_bits = ''.join(received)
    status = 'inconclusive'
    reason = '校准无效或数据不足'
    if calibration_valid:
        has_unknown = '?' in received_bits
        if has_unknown:
            status = 'inconclusive'
            reason = '部分载荷位无法解码'
        else:
            status = 'decoded'
            reason = '基于温度采样独立解码，不保证正确性'
    return {
        'receivedBits': received_bits,
        'status': status,
        'reason': reason,
        'calibration': {
            'zeroMean': zero_mean,
            'oneMean': one_mean,
            'threshold': threshold,
            'separationC': separation,
            'valid': calibration_valid
        },
        'slots': slots_out
    }


def run_sender(config):
    bits = config['bits']
    cpu = config['senderCPU']
    start_time = config['startTime']
    slot_seconds = config['slotSeconds']
    sensor_path = config['sensorPath']
    os.sched_setaffinity(0, {cpu})
    now = time.monotonic
    while now() < start_time:
        time.sleep(0.01)
    total_slots = len(bits)
    for slot_idx in range(total_slots):
        bit = bits[slot_idx]
        slot_start = start_time + slot_idx * slot_seconds
        slot_end = slot_start + slot_seconds
        cycles_per_slot = int(slot_seconds * 1000 / (BUSY_MS + SLEEP_MS))
        for cycle in range(cycles_per_slot):
            ok, msg = check_safety(sensor_path)
            if not ok:
                print(msg, file=sys.stderr, flush=True)
                return 1
            cycle_start = slot_start + cycle * (BUSY_MS + SLEEP_MS) / 1000
            if bit == '1':
                busy_end = cycle_start + BUSY_MS / 1000
                counter = 0
                while now() < busy_end:
                    data = f'{counter}{cycle}{slot_idx}'.encode()
                    hashlib.sha256(data).digest()
                    counter += 1
            sleep_start = cycle_start + BUSY_MS / 1000 if bit == '1' else cycle_start
            sleep_end = cycle_start + (BUSY_MS + SLEEP_MS) / 1000
            remaining = sleep_end - now()
            if remaining > 0:
                time.sleep(remaining)
        remaining_slot = slot_end - now()
        if remaining_slot > 0:
            time.sleep(remaining_slot)
    ok, msg = check_safety(sensor_path)
    if not ok:
        print(msg, file=sys.stderr, flush=True)
        return 1
    print(json.dumps({'status': 'completed'}), flush=True)
    return 0


def run_receiver(config):
    sensor_path = config['sensorPath']
    sensor_label = config['sensorLabel']
    cpu = config['receiverCPU']
    start_time = config['startTime']
    slot_seconds = config['slotSeconds']
    preamble = config['preamble']
    payload_length = config['payloadLength']
    os.sched_setaffinity(0, {cpu})
    now = time.monotonic
    while now() < start_time:
        time.sleep(0.01)
    total_slots = len(preamble) + payload_length
    duration = total_slots * slot_seconds
    samples = []
    sample_index = 0
    next_sample = start_time
    end_time = start_time + duration
    while now() < end_time:
        ok, msg = check_safety(sensor_path)
        if not ok:
            print(msg, file=sys.stderr, flush=True)
            return 1
        temp = read_temperature(sensor_path)
        elapsed = now() - start_time
        samples.append({'seconds': elapsed, 'temperatureC': temp})
        sample_index = max(sample_index + 1, int((now() - start_time) / SAMPLE_INTERVAL) + 1)
        next_sample = start_time + sample_index * SAMPLE_INTERVAL
        delay = next_sample - now()
        if delay > 0:
            time.sleep(delay)
    result = decode(samples, payload_length, slot_seconds, preamble)
    output = {
        'receivedBits': result['receivedBits'],
        'status': result['status'],
        'reason': result['reason'],
        'calibration': result['calibration'],
        'slots': result['slots'],
        'samples': samples,
        'signal': {'label': sensor_label, 'path': sensor_path, 'kind': 'temperature', 'unit': '°C'},
        'receiverCPU': cpu,
        'slotSeconds': slot_seconds,
        'preamble': preamble
    }
    print(json.dumps(output, allow_nan=False), flush=True)
    return 0


def collect_children(processes, deadline, start_time, total_slots):
    """Drain all four pipes without threads, within the runner's 128 MiB limit."""
    outputs = {proc: {'out': bytearray(), 'err': bytearray()} for proc in processes}
    last_slot = -1
    with selectors.DefaultSelector() as selector:
        for proc in processes:
            selector.register(proc.stdout, selectors.EVENT_READ, (proc, 'out'))
            selector.register(proc.stderr, selectors.EVENT_READ, (proc, 'err'))
        while selector.get_map() or any(proc.poll() is None for proc in processes):
            if time.monotonic() >= deadline:
                raise RuntimeError('收发超时，已停止子进程')
            for key, _ in selector.select(.1):
                proc, kind = key.data
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                outputs[proc][kind].extend(data)
                if len(outputs[proc][kind]) > (262144 if kind == 'out' else 8192):
                    raise RuntimeError('子进程输出超出限制')
            for proc, label in zip(processes, ('发送端', '接收端')):
                if proc.poll() is not None and proc.returncode != 0:
                    detail = outputs[proc]['err'].decode(errors='replace')[:1000]
                    raise RuntimeError(f'{label}停止：{detail or "运行条件不满足"}')
            slot = int(max(0, time.monotonic() - start_time) // SLOT_SECONDS)
            if slot != last_slot:
                print(f'收发进度 {min(slot, total_slots)} / {total_slots} 个时隙（含 4 位校准）', flush=True)
                last_slot = slot
    return {proc: bytes(value['out']) for proc, value in outputs.items()}


def run_coordinator():
    validate_environment()
    raw = sys.stdin.read(8193)
    if len(raw) > 8192:
        raise SystemExit('输入过长')
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f'输入 JSON 解析失败: {e}')
    if not isinstance(config, dict):
        raise SystemExit('输入必须是 JSON 对象。')
    if config.get('dedicatedHostConfirmed') is not True:
        raise SystemExit('需要 dedicatedHostConfirmed=true 确认专用主机。')
    bits = config.get('bits', '')
    if not validate_bits(bits):
        raise SystemExit(f'bits 必须为 1..{MAX_PAYLOAD_BITS} 位二进制字符串。')
    topology = discover_topology()
    if not topology:
        raise SystemExit('无法读取 CPU 拓扑信息。')
    sender_cpu, receiver_cpu, socket_id = select_cores(topology)
    if sender_cpu is None:
        raise SystemExit('同一插槽内找不到两个不同物理核心。')
    sensor_path, sensor_label = find_socket_sensor(socket_id)
    if sensor_path is None:
        raise SystemExit(f'未找到插槽 {socket_id} 的 Package 温度传感器。')
    ok, msg = check_safety(sensor_path)
    if not ok:
        raise SystemExit(f'安全检查失败: {msg}')
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    start_time = time.monotonic() + STARTUP_DELAY
    full_bits = PREAMBLE + bits
    sender_config = {
        'bits': full_bits,
        'senderCPU': sender_cpu,
        'startTime': start_time,
        'slotSeconds': SLOT_SECONDS,
        'sensorPath': sensor_path
    }
    receive_settings = receiver_config(sensor_path, sensor_label, receiver_cpu, start_time, len(bits))
    print('@@phase preparing', flush=True)
    print(f'发送端 CPU {sender_cpu}，接收端 CPU {receiver_cpu}，插槽 {socket_id}', flush=True)
    print('@@phase transmitting', flush=True)
    sender_proc = None
    receiver_proc = None
    try:
        sender_cmd = [sys.executable, __file__, 'send']
        receiver_cmd = [sys.executable, __file__, 'receive']
        sender_proc = subprocess.Popen(sender_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        receiver_proc = subprocess.Popen(receiver_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        sender_proc.stdin.write(json.dumps(sender_config).encode())
        sender_proc.stdin.close()
        receiver_proc.stdin.write(json.dumps(receive_settings).encode())
        receiver_proc.stdin.close()
        deadline = time.monotonic() + TIMEOUT_SECONDS
        try:
            captures = collect_children((sender_proc, receiver_proc), deadline, start_time, len(full_bits))
            sender_stdout, receiver_stdout = captures[sender_proc], captures[receiver_proc]
        finally:
            stop_children((sender_proc, receiver_proc))
        sender_result = json.loads(sender_stdout.decode())
        receiver_result = json.loads(receiver_stdout.decode())
        if 'error' in sender_result:
            raise RuntimeError(f'发送端错误: {sender_result["error"]}')
        if 'error' in receiver_result:
            raise RuntimeError(f'接收端错误: {receiver_result["error"]}')
        print('@@phase collecting', flush=True)
        duration = time.monotonic() - start_time + STARTUP_DELAY
        notes = [
            '本实验为独立的温度传导演示，并非原始 TRM 论文复现。',
            '环境噪声可能导致解码失败或结果不准确。',
            '解码状态 decoded 仅表示流程完成，不保证比特正确。'
        ]
        channel_result = {
            'version': 1,
            'source': 'thermal-channel',
            'startedAt': started_at,
            'durationSeconds': round(duration, 2),
            'signal': receiver_result['signal'],
            'senderCPU': sender_cpu,
            'receiverCPU': receiver_cpu,
            'slotSeconds': SLOT_SECONDS,
            'preamble': PREAMBLE,
            'sentBits': bits,
            'receivedBits': receiver_result['receivedBits'],
            'calibration': receiver_result['calibration'],
            'slots': receiver_result['slots'],
            'samples': receiver_result['samples'],
            'status': receiver_result['status'],
            'reason': receiver_result['reason'],
            'limits': {
                'maxTemperatureC': MAX_TEMPERATURE_C,
                'dutyCycle': DUTY_CYCLE,
                'maxPayloadBits': MAX_PAYLOAD_BITS
            },
            'notes': notes
        }
        metadata = {
            'experiment': 'channel',
            'startedAt': started_at,
            'durationSeconds': round(duration, 2),
            'senderCPU': sender_cpu,
            'receiverCPU': receiver_cpu,
            'status': receiver_result['status'],
            'notes': notes
        }
        output_dir = Path('results')
        output_dir.mkdir(exist_ok=True)
        for name, data in [('channel-result.json', channel_result), ('metadata.json', metadata)]:
            tmp = output_dir / (name + '.tmp')
            tmp.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False) + '\n')
            tmp.replace(output_dir / name)
        print(f'结果已写入 results/channel-result.json，状态: {receiver_result["status"]}', flush=True)
    except Exception as e:
        print(f'协调器错误: {e}', file=sys.stderr, flush=True)
        raise
    finally:
        stop_children((sender_proc, receiver_proc))


def stop_children(processes):
    for proc in processes:
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass
    for proc in processes:
        if proc is not None:
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)


def receiver_config(sensor_path, sensor_label, cpu, start_time, payload_length):
    return {'sensorPath': sensor_path, 'sensorLabel': sensor_label, 'receiverCPU': cpu,
            'startTime': start_time, 'slotSeconds': SLOT_SECONDS, 'preamble': PREAMBLE,
            'payloadLength': payload_length}


def cancelled(signum, frame):
    raise SystemExit('本次收发已停止')


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    if len(sys.argv) < 2:
        run_coordinator()
    elif sys.argv[1] == 'send':
        validate_environment()
        config = json.loads(sys.stdin.read(8192))
        if (not isinstance(config.get('bits'), str) or not config['bits'].startswith(PREAMBLE)
                or not validate_bits(config['bits'][len(PREAMBLE):]) or config.get('slotSeconds') != SLOT_SECONDS):
            raise SystemExit('发送参数不正确')
        sys.exit(run_sender(config))
    elif sys.argv[1] == 'receive':
        validate_environment()
        config = json.loads(sys.stdin.read(8192))
        if (type(config.get('payloadLength')) is not int or not 1 <= config['payloadLength'] <= 8
                or config.get('slotSeconds') != SLOT_SECONDS or config.get('preamble') != PREAMBLE):
            raise SystemExit('接收参数不正确')
        sys.exit(run_receiver(config))
    else:
        raise SystemExit(f'未知模式: {sys.argv[1]}')
