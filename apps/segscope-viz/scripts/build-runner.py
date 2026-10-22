from pathlib import Path
import gzip
import hashlib
import io
import json
import tarfile

root = Path(__file__).resolve().parent.parent
upstream = root/'third_party/segscope'
source = json.loads((upstream/'SOURCE.json').read_text())
for name, digest in source['files'].items():
    if hashlib.sha256((upstream/name).read_bytes()).hexdigest() != digest:
        raise SystemExit(f'Upstream source checksum mismatch: {name}')
entries = [(p, p.relative_to(root/'scripts/runner').as_posix()) for p in (root/'scripts/runner').rglob('*') if p.is_file() and '__pycache__' not in p.parts]
entries += [(p, 'upstream/'+p.relative_to(upstream).as_posix()) for p in upstream.rglob('*') if p.is_file()]
buffer = io.BytesIO()
with gzip.GzipFile(fileobj=buffer, mode='wb', mtime=0) as compressed:
    with tarfile.open(fileobj=compressed, mode='w') as archive:
        for path, name in sorted(entries, key=lambda item: item[1]):
            data = path.read_bytes()
            info = tarfile.TarInfo(name); info.size = len(data); info.mtime = 0; info.mode = 0o600
            archive.addfile(info, io.BytesIO(data))
out = root/'server/assets/runner.tar.gz'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(buffer.getvalue())
print(f'runner bundle: {len(buffer.getvalue())} bytes, sha256={hashlib.sha256(buffer.getvalue()).hexdigest()}')
