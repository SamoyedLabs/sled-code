#!/usr/bin/env python3
"""Prepare the checksum-pinned native WebRTC dependency for internal spikes."""
import hashlib
import json
from pathlib import Path
import stat
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
source = json.loads((root / 'sources.lock.json').read_text())['nativeWebRTCSpike']
version = source['version']
checksum = source['sha256']
cache = root / '.tools/webrtc'
cache.mkdir(parents=True, exist_ok=True)
archive = cache / f'LiveKitWebRTC-{version}.zip'
if not archive.exists():
    partial = archive.with_suffix('.download')
    urllib.request.urlretrieve(
        source['archive'],
        partial,
    )
    partial.replace(archive)
with archive.open('rb') as source:
    hasher = hashlib.sha256()
    for block in iter(lambda: source.read(1024 * 1024), b''):
        hasher.update(block)
    digest = hasher.hexdigest()
if digest != checksum:
    raise SystemExit(f'WebRTC archive checksum mismatch: {digest}')

# Do not expand unrelated platforms or dSYMs from the 655 MiB upstream archive.
slices = ('macos-arm64_x86_64/', 'ios-arm64/', 'ios-arm64_x86_64-simulator/')
prefix = 'LiveKitWebRTC.xcframework/'
with zipfile.ZipFile(archive) as source:
    for member in source.infolist():
        if not member.filename.startswith(prefix):
            continue
        relative = member.filename[len(prefix):]
        if relative in ('Info.plist', 'LICENSE') or any(relative.startswith(s) for s in slices):
            if '..' in Path(member.filename).parts or Path(member.filename).is_absolute():
                raise SystemExit('Unsafe WebRTC archive path')
            destination = cache / member.filename
            if stat.S_ISLNK(member.external_attr >> 16):
                target = source.read(member).decode('utf-8')
                if not (destination.parent / target).resolve().is_relative_to(cache.resolve()):
                    raise SystemExit('Unsafe WebRTC archive symlink')
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists() or destination.is_symlink():
                    destination.unlink()
                destination.symlink_to(target)
            elif not destination.is_symlink():
                source.extract(member, cache)
print(f'Verified LiveKitWebRTC {version}: {checksum}')
print(cache / prefix)
