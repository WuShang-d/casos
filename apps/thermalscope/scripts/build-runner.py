#!/usr/bin/env python3
import gzip
import io
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[1]
content = io.BytesIO()
with tarfile.open(fileobj=content, mode='w') as archive:
    for name in ('runner.sh', 'sample.py', 'channel.py'):
        path = root/'scripts/runner'/name
        info = tarfile.TarInfo(name)
        data = path.read_bytes()
        info.size, info.mode, info.mtime = len(data), 0o700, 0
        archive.addfile(info, io.BytesIO(data))
output = root/'server/assets/runner.tar.gz'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(gzip.compress(content.getvalue(), mtime=0))
print(f'Built {output.name}: {output.stat().st_size} bytes')
