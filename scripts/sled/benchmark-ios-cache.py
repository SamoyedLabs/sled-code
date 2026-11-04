#!/usr/bin/env python3
"""Measure native compiler reuse without signing or publishing an app."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('label', choices=['cold', 'warm'])
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('hosted-mobile-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.configure(require_signing=False)
root = Path(os.environ['RUNNER_TEMP']) / 'sled-native-cache-benchmark'
root.mkdir(exist_ok=True)
credentials = root / 'empty-credentials'
credentials.mkdir(exist_ok=True)
public = root / 'public.json'
public.write_text(json.dumps({key: os.environ[key] for key in release.PUBLIC}))
if args.label == 'cold':
    release.prepare_runtime(os.environ['GITHUB_SHA'], root)
for name in ('derived-data', 'current'):
    shutil.rmtree(root / name, ignore_errors=True)
subprocess.run([sys.executable, str(release.ROOT / 'scripts/testflight-ios.py'), 'archive',
                '--unsigned', '--team', release.TEAM, '--build-number', '1',
                '--bundle-id', release.BUNDLE, '--prepare', '--skip-prebuild',
                '--enable-ota', '--ota-channel', release.CHANNEL,
                '--credentials-dir', str(credentials), '--public-config', str(public),
                '--derived-data-path', str(root / 'derived-data'), '--output-dir', str(root / 'current')], check=True)
destination = root / args.label
destination.mkdir(exist_ok=True)
for name in ('phase-timings.jsonl', 'compilation-cache-statistics.json'):
    shutil.copyfile(root / 'current' / name, destination / name)
records = [json.loads(line) for line in (destination / 'phase-timings.jsonl').read_text().splitlines()]
stats = json.loads((destination / 'compilation-cache-statistics.json').read_text())
archive = next(row['elapsed_seconds'] for row in records if row['phase'] == 'archive')
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
    summary.write(f'### Native cache benchmark: {args.label}\n\nArchive: {archive:.1f}s; compiler hits: {stats["hits"]}; misses: {stats["misses"]}.\n\n')
    summary.write('Unsigned Release archive; same VM and dependencies, fresh DerivedData. Does not measure signing, publication, or Apple processing.\n')
if args.label == 'warm' and not stats['hits']:
    raise SystemExit('Restored compiler cache produced zero hits')
