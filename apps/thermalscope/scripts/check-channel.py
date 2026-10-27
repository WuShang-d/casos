#!/usr/bin/env python3
import json
import os
import sys
import tempfile
import unittest
import subprocess
import time
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / 'runner'))
import channel


class TestBitValidation(unittest.TestCase):
    def test_valid_bits(self):
        self.assertTrue(channel.validate_bits('0'))
        self.assertTrue(channel.validate_bits('1'))
        self.assertTrue(channel.validate_bits('0101'))
        self.assertTrue(channel.validate_bits('11111111'))

    def test_invalid_bits_empty(self):
        self.assertFalse(channel.validate_bits(''))

    def test_invalid_bits_too_long(self):
        self.assertFalse(channel.validate_bits('010101010'))

    def test_invalid_bits_non_binary(self):
        self.assertFalse(channel.validate_bits('012'))
        self.assertFalse(channel.validate_bits('abc'))

    def test_invalid_bits_type(self):
        self.assertFalse(channel.validate_bits(123))
        self.assertFalse(channel.validate_bits(None))


class TestDecodeCleanPreamble(unittest.TestCase):
    def setUp(self):
        self.preamble = '0101'
        self.payload_length = 4
        self.slot_seconds = 6
        base_temp = 50.0
        zero_level = base_temp
        one_level = base_temp + 1.5
        samples = []
        bits = self.preamble + '1010'
        for slot_idx, bit in enumerate(bits):
            level = one_level if bit == '1' else zero_level
            slot_start = slot_idx * self.slot_seconds
            for i in range(15):
                sec = slot_start + self.slot_seconds / 2 + i * 0.2
                samples.append({'seconds': sec, 'temperatureC': level})
        self.samples = samples

    def test_clean_decode(self):
        result = channel.decode(self.samples, self.payload_length, self.slot_seconds, self.preamble)
        self.assertTrue(result['calibration']['valid'])
        self.assertEqual(result['receivedBits'], '1010')
        self.assertEqual(result['status'], 'decoded')
        self.assertIsNotNone(result['calibration']['threshold'])
        self.assertGreaterEqual(result['calibration']['separationC'], 0.5)


class TestDecodeFlatTrace(unittest.TestCase):
    def test_flat_calibration_fails(self):
        samples = []
        for slot_idx in range(8):
            slot_start = slot_idx * 6
            for i in range(15):
                sec = slot_start + 3 + i * 0.2
                samples.append({'seconds': sec, 'temperatureC': 50.0})
        result = channel.decode(samples, 4, 6, '0101')
        self.assertFalse(result['calibration']['valid'])
        self.assertEqual(result['receivedBits'], '????')
        self.assertEqual(result['status'], 'inconclusive')


class TestDecodeWeakSignal(unittest.TestCase):
    def test_weak_separation(self):
        samples = []
        preamble = '0101'
        payload = '1010'
        bits = preamble + payload
        zero_level = 50.0
        one_level = 50.3
        for slot_idx, bit in enumerate(bits):
            level = one_level if bit == '1' else zero_level
            slot_start = slot_idx * 6
            for i in range(15):
                sec = slot_start + 3 + i * 0.2
                samples.append({'seconds': sec, 'temperatureC': level})
        result = channel.decode(samples, 4, 6, preamble)
        self.assertFalse(result['calibration']['valid'])
        self.assertEqual(result['status'], 'inconclusive')


class TestDecodeInvertedCalibration(unittest.TestCase):
    def test_inverted_means(self):
        samples = []
        preamble = '0101'
        payload = '1010'
        bits = preamble + payload
        zero_level = 52.0
        one_level = 50.0
        for slot_idx, bit in enumerate(bits):
            level = one_level if bit == '1' else zero_level
            slot_start = slot_idx * 6
            for i in range(15):
                sec = slot_start + 3 + i * 0.2
                samples.append({'seconds': sec, 'temperatureC': level})
        result = channel.decode(samples, 4, 6, preamble)
        self.assertFalse(result['calibration']['valid'])
        self.assertEqual(result['receivedBits'], '????')


class TestDecodeGappedSamples(unittest.TestCase):
    def test_insufficient_samples_per_slot(self):
        samples = []
        for slot_idx in range(8):
            slot_start = slot_idx * 6
            for i in range(5):
                sec = slot_start + 3 + i * 0.2
                samples.append({'seconds': sec, 'temperatureC': 50.0 if slot_idx % 2 == 0 else 52.0})
        result = channel.decode(samples, 4, 6, '0101')
        self.assertFalse(result['calibration']['valid'])
        self.assertEqual(result['status'], 'inconclusive')


class TestDecodeWrongBitRetained(unittest.TestCase):
    def test_intentionally_wrong_measurement(self):
        samples = []
        preamble = '0101'
        payload = '1010'
        bits = preamble + payload
        zero_level = 50.0
        one_level = 52.0
        for slot_idx, bit in enumerate(bits):
            if slot_idx >= len(preamble) and slot_idx - len(preamble) == 0:
                level = zero_level
            else:
                level = one_level if bit == '1' else zero_level
            slot_start = slot_idx * 6
            for i in range(15):
                sec = slot_start + 3 + i * 0.2
                samples.append({'seconds': sec, 'temperatureC': level})
        result = channel.decode(samples, 4, 6, preamble)
        self.assertTrue(result['calibration']['valid'])
        self.assertEqual(result['receivedBits'][0], '0')
        self.assertNotEqual(result['receivedBits'][0], '1')


class TestReceiverConfigExcludesBits(unittest.TestCase):
    def test_receiver_config_structure(self):
        config = channel.receiver_config('/sys/coretemp', 'Package id 0', 2, 1000., 4)
        self.assertNotIn('bits', config)
        self.assertNotIn('sentBits', config)
        self.assertIn('payloadLength', config)
        self.assertIn('preamble', config)


class TestTopologySelection(unittest.TestCase):
    def test_select_cores_same_socket(self):
        topology = [
            {'cpu': 0, 'package': '0', 'core': '0'},
            {'cpu': 1, 'package': '0', 'core': '1'},
            {'cpu': 2, 'package': '0', 'core': '0'},
            {'cpu': 3, 'package': '1', 'core': '0'}
        ]
        sender, receiver, socket = channel.select_cores(topology)
        self.assertIsNotNone(sender)
        self.assertIsNotNone(receiver)
        self.assertNotEqual(sender, receiver)
        self.assertEqual(socket, '0')

    def test_select_cores_no_two_different_cores(self):
        topology = [
            {'cpu': 0, 'package': '0', 'core': '0'},
            {'cpu': 1, 'package': '0', 'core': '0'},
            {'cpu': 2, 'package': '1', 'core': '0'}
        ]
        sender, receiver, socket = channel.select_cores(topology)
        self.assertIsNone(sender)
        self.assertIsNone(receiver)


class TestSensorDiscovery(unittest.TestCase):
    def test_find_sensor_with_temp_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            hwmon_dir = Path(tmpdir) / 'hwmon0'
            hwmon_dir.mkdir()
            (hwmon_dir / 'name').write_text('coretemp\n')
            (hwmon_dir / 'temp1_label').write_text('Package id 0\n')
            (hwmon_dir / 'temp1_input').write_text('50000\n')
            original_glob = channel.glob.glob
            def mock_glob(pattern):
                if 'temp*_label' in pattern:
                    return [str(hwmon_dir / 'temp1_label')]
                return original_glob(pattern)
            channel.glob.glob = mock_glob
            try:
                path, label = channel.find_socket_sensor('0')
                self.assertIsNotNone(path)
                self.assertIn('Package id 0', label)
            finally:
                channel.glob.glob = original_glob


class TestSafetyCheck(unittest.TestCase):
    def test_safe_temperature(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='_input', delete=False) as f:
            f.write('50000\n')
            f.flush()
            ok, msg = channel.check_safety(f.name)
            self.assertTrue(ok)
            self.assertIsNone(msg)
            os.unlink(f.name)

    def test_overheat_temperature(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='_input', delete=False) as f:
            f.write('85000\n')
            f.flush()
            ok, msg = channel.check_safety(f.name)
            self.assertFalse(ok)
            self.assertIn('超过安全上限', msg)
            os.unlink(f.name)

    def test_unreadable_sensor(self):
        ok, msg = channel.check_safety('/nonexistent/path/temp_input')
        self.assertFalse(ok)
        self.assertIn('不可读', msg)


class TestDecodeResultStructure(unittest.TestCase):
    def test_result_keys(self):
        samples = []
        for slot_idx in range(8):
            slot_start = slot_idx * 6
            for i in range(15):
                sec = slot_start + 3 + i * 0.2
                temp = 50.0 if slot_idx % 2 == 0 else 52.0
                samples.append({'seconds': sec, 'temperatureC': temp})
        result = channel.decode(samples, 4, 6, '0101')
        self.assertIn('receivedBits', result)
        self.assertIn('status', result)
        self.assertIn('reason', result)
        self.assertIn('calibration', result)
        self.assertIn('slots', result)
        cal = result['calibration']
        self.assertIn('zeroMean', cal)
        self.assertIn('oneMean', cal)
        self.assertIn('threshold', cal)
        self.assertIn('separationC', cal)
        self.assertIn('valid', cal)


class TestLifecycleAndCoverage(unittest.TestCase):
    def test_large_pipe_output_does_not_deadlock(self):
        # These helper processes only write bytes: they never call the thermal sender.
        children = [subprocess.Popen([sys.executable, '-c', 'import sys;sys.stdout.write("x"*70000)'],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
        try:
            output = channel.collect_children(children, time.monotonic() + 5, time.monotonic(), 1)
            self.assertEqual([len(output[p]) for p in children], [70000, 70000])
        finally:
            channel.stop_children(children)
            for p in children:
                p.stdout.close(); p.stderr.close()

    def test_failed_peer_is_reaped(self):
        children = [subprocess.Popen([sys.executable, '-c', 'import sys;sys.stderr.write("sensor failed");sys.exit(1)'], stdout=subprocess.PIPE, stderr=subprocess.PIPE),
                    subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)]
        try:
            with self.assertRaises(RuntimeError):
                channel.collect_children(children, time.monotonic() + 5, time.monotonic(), 1)
        finally:
            channel.stop_children(children)
            self.assertTrue(all(p.poll() is not None for p in children))
            for p in children:
                p.stdout.close(); p.stderr.close()

    def test_missing_one_calibration_slot_never_calibrates(self):
        samples = [{'seconds': idx * 6 + 3 + j * .2, 'temperatureC': 50 if bit == '0' else 52}
                   for idx, bit in enumerate('01011010') if idx != 2 for j in range(15)]
        self.assertEqual(channel.decode(samples, 4)['receivedBits'], '????')

    def test_clustered_samples_are_not_full_window_evidence(self):
        samples = [{'seconds': idx * 6 + 3 + j * .001, 'temperatureC': 50 if idx % 2 == 0 else 52}
                   for idx in range(8) for j in range(15)]
        self.assertEqual(channel.decode(samples, 4)['receivedBits'], '????')

    def test_non_coretemp_sensor_is_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'name').write_text('other')
            (p/'temp1_label').write_text('Package id 0')
            (p/'temp1_input').write_text('50000')
            with patch.object(channel.glob, 'glob', return_value=[str(p/'temp1_label')]):
                self.assertEqual(channel.find_socket_sensor('0'), (None, None))


if __name__ == '__main__':
    unittest.main()
