#!/usr/bin/env python3
"""Verify pinned dependency notices and stage them with both native clients."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--audit-symbols', action='store_true',
                    help='Check vendor debug UUIDs and compiled source coverage on macOS.')
args = parser.parse_args()
source = root / 'third-party/webrtc'
manifest = json.loads((source / 'manifest.json').read_text())
pin = json.loads((root / 'sources.lock.json').read_text())['nativeWebRTCSpike']
for field, expected in [('version', pin['version']), ('sourceCommit', pin['sourceCommit']),
                        ('distributionCommit', pin['commit']), ('archiveSha256', pin['sha256'])]:
    if manifest[field] != expected:
        raise SystemExit(f'WebRTC notice audit does not match pinned {field}')

covered = {entry['component'] for entry in manifest['files']}
for alias, notices in manifest['coverageAliases'].items():
    if set(notices) <= covered:
        covered.add(alias)
observed = set().union(*(set(a['observedThirdPartyComponents']) for a in manifest['binaryAudit'].values()))
if observed - covered:
    raise SystemExit('Missing component notices: ' + ', '.join(sorted(observed - covered)))

if args.audit_symbols:
    archive = root / f'.tools/webrtc/LiveKitWebRTC-{pin["version"]}.zip'
    checksum = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    if checksum.hexdigest() != pin['sha256']:
        raise SystemExit('WebRTC archive checksum mismatch')
    cache = root / '.tools/webrtc/dsym-audit'
    cache.mkdir(exist_ok=True)
    def uuids(path):
        text = subprocess.check_output(['xcrun', 'dwarfdump', '--uuid', str(path)], text=True)
        return sorted(re.findall(r'UUID: ([A-Fa-f0-9-]+) \(([^)]+)\)', text))
    with zipfile.ZipFile(archive) as bundle:
        for architecture, audit in manifest['binaryAudit'].items():
            debug = cache / (architecture + '.dwarf')
            if not debug.exists():
                debug.write_bytes(bundle.read(f'LiveKitWebRTC.xcframework/{architecture}/dSYMs/'
                                             'LiveKitWebRTC.framework.dSYM/Contents/Resources/DWARF/LiveKitWebRTC'))
            binary = root / '.tools/webrtc/LiveKitWebRTC.xcframework' / architecture / 'LiveKitWebRTC.framework/LiveKitWebRTC'
            expected = sorted((a['uuid'], a['architecture']) for a in audit['uuids'])
            if uuids(debug) != expected or uuids(binary) != expected:
                raise SystemExit(f'Binary/debug UUID mismatch: {architecture}')
            sources = subprocess.check_output(['xcrun', 'dwarfdump', '--show-sources', str(debug)], text=True)
            components = {name for line in sources.splitlines() for name in re.findall(r'/third_party/([^/]+)/', line)}
            if components != set(audit['observedThirdPartyComponents']):
                raise SystemExit(f'Compiled dependency coverage changed: {architecture}')

parts = [f'T3 Code remote desktop — WebRTC {pin["version"]} third-party notices\n',
         'Upstream license and patent notices are reproduced below. Source revisions and\n'
         'binary audit provenance are in LiveKitWebRTC-PROVENANCE.json.\n']
for entry in manifest['files']:
    filename = entry['file']
    if Path(filename).name != filename:
        raise SystemExit('Invalid notice path')
    data = (source / filename).read_bytes()
    if hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise SystemExit(f'Notice checksum mismatch: {filename}')
    text = data.decode('utf-8')
    if entry['component'] == 'vector':
        text = text[:text.index('*/') + 2]
    parts += ['\n' + '=' * 72 + '\n', entry['component'] + ' — ' + entry['sourcePath'] + '\n',
              entry['url'] + '\n\n', text.rstrip() + '\n']

destination = root / 'apps/mobile/modules/t3-remote-desktop/Vendor'
destination.mkdir(parents=True, exist_ok=True)
notices_text = ''.join(parts)
provenance = dict(manifest, noticeBundleSha256=hashlib.sha256(notices_text.encode()).hexdigest())
for name, text in [('LiveKitWebRTC-THIRD-PARTY-NOTICES.txt', notices_text),
                   ('LiveKitWebRTC-PROVENANCE.json', json.dumps(provenance, indent=2) + '\n')]:
    path = destination / name
    if not path.exists() or path.read_text() != text:
        path.write_text(text)
print(f'Verified {len(manifest["files"])} pinned notice files covering {len(observed)} observed components.')
