import ctypes
import json
import os
import pickle
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split

root = Path(__file__).resolve().parent
source = (root / 'upstream/E1-Fingerprinting_Websites/tick.c').read_text()
source = source.replace('CPU_SET(3, &mask)', f'CPU_SET({int(os.environ["SEGSCOPE_CPU"])}, &mask)')
source = source.replace('int ret, i, count;', 'int ret, i, count = 0;')
(root / 'tick.c').write_text(source)
subprocess.run(['gcc', '-shared', '-fPIC', '-O0', 'tick.c', '-o', 'tick.so'], check=True)
sampler = ctypes.CDLL(str(root / 'tick.so'))
sampler.count_tick.restype = ctypes.c_int
sites = ['https://www.pku.edu.cn', 'https://www.baidu.com', 'https://www.bing.com', 'https://www.tsinghua.edu.cn']
traces, labels, failures = [], [], []
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, chromium_sandbox=True, args=['--renderer-process-limit=2'])
    context = browser.new_context()
    page = context.new_page()
    try:
        with (root / 'results/traces.pkl').open('wb') as output:
            for site in sites:
                for run in range(7):
                    samples = []
                    def sample():
                        for _ in range(500):
                            value = sampler.count_tick()
                            if value < 0:
                                raise RuntimeError('采样值超出计数范围')
                            samples.append(value)
                    worker = threading.Thread(target=sample, daemon=True)
                    worker.start()
                    try:
                        response = page.goto(site, wait_until='domcontentloaded', timeout=10000)
                        if response is None or response.status >= 400:
                            raise RuntimeError('网页未成功返回')
                    except Exception as error:
                        worker.join(timeout=20)
                        if worker.is_alive():
                            raise RuntimeError('采样等待超时')
                        failures.append({'site': site, 'run': run, 'error': type(error).__name__})
                        print(f'网页未成功打开，跳过本条记录：{site}；{str(error)[:300]}', flush=True)
                        continue
                    worker.join(timeout=20)
                    if worker.is_alive():
                        raise RuntimeError('采样等待超时')
                    if len(samples) != 500:
                        raise RuntimeError('采样未返回完整记录')
                    if run == 0:
                        continue
                    traces.append(samples)
                    labels.append(site)
                    pickle.dump(([samples], site), output, protocol=4)
                    print(f'已采集 {len(traces)}/24 条记录：{site}', flush=True)
    finally:
        context.close()
        browser.close()
if any(labels.count(site) < 4 for site in sites):
    raise RuntimeError('部分网站未取得足够记录，不能据此给出识别准确率；请检查目标机访问这些网站的网络。')
train_x, test_x, train_y, test_y = train_test_split(np.array(traces), labels, test_size=0.5, stratify=labels, random_state=42)
model = RandomForestClassifier(n_estimators=100, n_jobs=1, random_state=42)
model.fit(train_x, train_y)
predictions = model.predict(test_x)
accuracy = accuracy_score(test_y, predictions) * 100
(root / 'results/report.txt').write_text(f'Number of traces: {len(traces)}\ntop1 accuracy: {accuracy:.1f}%\n')
(root / 'results/predictions.json').write_text(json.dumps({'labels': sites, 'matrix': confusion_matrix(test_y, predictions, labels=sites).tolist(), 'testSamples': len(test_y)}, ensure_ascii=False))
(root / 'results/metadata.json').write_text(json.dumps({'experiment': 'E1', 'mode': 'headless-chromium', 'sites': sites, 'runsPerSite': 6, 'samplesPerTrace': 500, 'trainTestSeed': 42, 'failures': failures, 'note': '轻量自动采集，使用原仓库计数原语；参数与论文实验不同，不代表论文复现'}, ensure_ascii=False))
print(f'识别报告已生成，测试集 {len(test_y)} 条，准确率 {accuracy:.1f}%。', flush=True)
