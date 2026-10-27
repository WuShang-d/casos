#!/usr/bin/env python3
"""Build scratch-image archives from a Linux binary and frontend, without a daemon."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def add_bytes(archive, name, data, mode=0o644, uid=0):
    item = tarfile.TarInfo(name)
    item.size, item.mode, item.uid, item.gid, item.mtime = len(data), mode, uid, uid, 0
    archive.addfile(item, io.BytesIO(data))


def build(root, image, architecture):
    binary = (root/'thermalscope').read_bytes()
    if binary[:4] != b'\x7fELF':
        raise SystemExit('Expected a Linux ELF binary at ./thermalscope; build on pkusgx first.')
    if architecture != 'amd64' or int.from_bytes(binary[18:20], 'little') != 62:
        raise SystemExit('This release command currently packages a Linux amd64 binary only.')
    if not (root/'build/index.html').is_file():
        raise SystemExit('Missing frontend build/index.html')
    layer_stream = io.BytesIO()
    with tarfile.open(fileobj=layer_stream, mode='w') as layer:
        add_bytes(layer, 'thermalscope', binary, 0o755)
        for path in sorted((root/'build').rglob('*')):
            if path.is_symlink():
                raise SystemExit('Frontend build must not contain symlinks')
            if path.is_file():
                add_bytes(layer, 'app/build/'+str(path.relative_to(root/'build')), path.read_bytes())
        for name in ('LICENSE', 'NOTICE'):
            add_bytes(layer, 'licenses/'+name, (root/name).read_bytes())
        for path in sorted((root/'third_party/licenses').glob('*')):
            if path.is_file():
                add_bytes(layer, 'licenses/dependencies/'+path.name, path.read_bytes())
        data = tarfile.TarInfo('data')
        data.type, data.mode, data.uid, data.gid, data.mtime = tarfile.DIRTYPE, 0o700, 65532, 65532, 0
        layer.addfile(data)
    layer_bytes = layer_stream.getvalue()
    layer_id = sha(layer_bytes)
    config = encode({'architecture': architecture, 'os': 'linux', 'config': {
        'User': '65532:65532', 'WorkingDir': '/', 'Entrypoint': ['/thermalscope'],
        'Env': ['THERMALSCOPE_ADDR=:8080', 'THERMALSCOPE_STATIC_DIR=/app/build', 'THERMALSCOPE_DATA_DIR=/data/jobs', 'THERMALSCOPE_ENABLE_JOBS=true'],
        'ExposedPorts': {'8080/tcp': {}}, 'Volumes': {'/data': {}},
        'Labels': {'org.opencontainers.image.title': 'ThermalScope visualization', 'org.opencontainers.image.version': '0.1.0', 'org.opencontainers.image.licenses': 'Apache-2.0'}},
        'rootfs': {'type': 'layers', 'diff_ids': ['sha256:'+layer_id]},
        'history': [{'created_by': 'ThermalScope reproducible scratch image packager'}]})
    config_id = sha(config)
    release = root/'release'
    release.mkdir(exist_ok=True)
    docker_path = release/'thermalscope-0.1.0-linux-amd64.docker.tar'
    with tarfile.open(docker_path, 'w') as archive:
        add_bytes(archive, config_id+'.json', config)
        add_bytes(archive, layer_id+'/layer.tar', layer_bytes)
        add_bytes(archive, 'manifest.json', encode([{'Config': config_id+'.json', 'RepoTags': [image], 'Layers': [layer_id+'/layer.tar']}]))
    manifest = encode({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'config': {'mediaType': 'application/vnd.oci.image.config.v1+json', 'digest': 'sha256:'+config_id, 'size': len(config)}, 'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar', 'digest': 'sha256:'+layer_id, 'size': len(layer_bytes)}]})
    manifest_id = sha(manifest)
    index = encode({'schemaVersion': 2, 'manifests': [{'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'digest': 'sha256:'+manifest_id, 'size': len(manifest), 'platform': {'os': 'linux', 'architecture': architecture}, 'annotations': {'org.opencontainers.image.ref.name': image}}]})
    oci_path = release/'thermalscope-0.1.0-linux-amd64.oci.tar'
    with tarfile.open(oci_path, 'w') as archive:
        add_bytes(archive, 'oci-layout', encode({'imageLayoutVersion': '1.0.0'}))
        add_bytes(archive, 'index.json', index)
        for digest, value in [(config_id, config), (layer_id, layer_bytes), (manifest_id, manifest)]:
            add_bytes(archive, 'blobs/sha256/'+digest, value)
    checksums = []
    for path in (docker_path, oci_path):
        with tarfile.open(path) as archive:
            if path == docker_path:
                meta = json.load(archive.extractfile('manifest.json'))[0]
                assert sha(archive.extractfile(meta['Layers'][0]).read()) == layer_id
                assert json.load(archive.extractfile(meta['Config']))['config']['User'] == '65532:65532'
            else:
                for member in archive:
                    if member.name.startswith('blobs/'):
                        assert sha(archive.extractfile(member).read()) == member.name.rsplit('/', 1)[1]
        checksums.append(f'{sha(path.read_bytes())}  {path.name}')
        print(f'Built and verified {path.name}: {path.stat().st_size} bytes')
    (release/'SHA256SUMS').write_text('\n'.join(checksums)+'\n')
    (release/'image-info.json').write_text(json.dumps({'tag': image, 'manifestDigest': 'sha256:'+manifest_id, 'configDigest': 'sha256:'+config_id, 'platform': 'linux/amd64', 'user': '65532:65532', 'runtimeVerified': False}, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', default='thermalscope:0.1.0')
    parser.add_argument('--architecture', default='amd64', choices=['amd64'])
    args = parser.parse_args()
    build(Path(__file__).resolve().parents[1], args.image, args.architecture)
