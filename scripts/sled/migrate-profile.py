#!/usr/bin/env python3
"""Inventory or offline-copy T3 userdata to a separate Sled home. Never starts a server."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile

LIVE = Path.home() / '.t3' / 'userdata'


def safe_target(path):
    path = Path(path).expanduser().resolve()
    live = LIVE.resolve()
    if path == live.parent or path == live or live in path.parents or path in live.parents:
        raise ValueError('Destination overlaps the official live home')
    return path


def entries(source):
    source = Path(source).resolve()
    if not source.is_dir():
        raise ValueError('Source userdata directory is missing')
    result = []
    for path in sorted(source.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlinks require manual review; no profile was copied')
        if path.is_file():
            result.append(path)
        elif not path.is_dir():
            raise ValueError('Special files require manual review')
    return result


def inventory(source):
    files = entries(source)
    return {'source': str(source), 'files': len(files),
            'bytes': sum(p.stat().st_size for p in files),
            'stateV2Present': (source / 'statev2.sqlite').is_file(),
            'settingsPresent': (source / 'settings.json').is_file(),
            'action': 'read-only; no values or credentials included'}


def stopped(source):
    if os.name == 'nt':
        raise ValueError('Windows apply is not verified: inventory only; use a tested offline backup/cutover on copethyself')
    if not shutil.which('lsof'):
        raise ValueError('lsof is required to verify the profile is stopped')
    result = subprocess.run(['lsof', '-t', '+D', str(source)], capture_output=True)
    if result.stdout.strip() or result.returncode not in (0, 1) or result.stderr.strip():
        raise ValueError('Profile may be open or inspection failed; quit its host and retry')


def snapshot(source, destination):
    files = entries(source)
    destination.mkdir(mode=0o700)
    for path in files:
        relative = path.relative_to(source)
        if path.name.endswith(('-wal', '-shm', '-journal')):
            continue
        target = destination / relative
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open('rb') as stream:
            is_sqlite = stream.read(16) == b'SQLite format 3\x00'
        if is_sqlite:
            with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as origin:
                with sqlite3.connect(target) as backup:
                    origin.backup(backup)
                    if backup.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                        raise ValueError('SQLite backup integrity check failed')
        else:
            shutil.copyfile(path, target)
        target.chmod(0o600)


def hashes(directory):
    directory = Path(directory).resolve()
    result = {}
    for path in entries(directory):
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        result[str(path.relative_to(directory))] = digest.hexdigest()
    return result


def apply(source, home, backup_root):
    source = Path(source).expanduser().resolve()
    home = safe_target(home)
    backup_root = safe_target(backup_root)
    if source == home or source in home.parents or home in source.parents:
        raise ValueError('Source and Sled home overlap')
    if (backup_root == source or source in backup_root.parents or backup_root in source.parents
            or backup_root == home or home in backup_root.parents or backup_root in home.parents):
        raise ValueError('Backups, source and Sled home must be disjoint')
    if home.exists():
        raise ValueError('Sled home must not exist; existing profiles are never overwritten')
    inventory(source)
    stopped(source)
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    bundle = Path(tempfile.mkdtemp(prefix='sled-cutover-', dir=backup_root))
    bundle.chmod(0o700)
    snapshot(source, bundle / 'userdata')
    stopped(source)
    manifest = {'schema': 1, 'source': str(source), 'home': str(home),
                'hashes': hashes(bundle / 'userdata')}
    (bundle / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (bundle / 'manifest.json').chmod(0o600)
    home.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.sled-cutover-', dir=home.parent))
    try:
        shutil.copytree(bundle / 'userdata', temporary / 'userdata')
        if hashes(temporary / 'userdata') != manifest['hashes']:
            raise ValueError('Copy verification failed')
        if home.exists():
            raise ValueError('Destination appeared during copy')
        temporary.rename(home)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return {'backup': str(bundle), 'home': str(home), 'started': False,
            'warning': 'Full fidelity cutover copy: may contain schedules, sessions and links. Never launch as a development server.'}


def rollback(bundle):
    bundle = Path(bundle).expanduser().resolve()
    manifest = json.loads((bundle / 'manifest.json').read_text())
    home = safe_target(manifest['home'])
    if hashes(bundle / 'userdata') != manifest['hashes']:
        raise ValueError('Backup integrity mismatch')
    stopped(home)
    if home == bundle or home in bundle.parents or bundle in home.parents:
        raise ValueError('Backup overlaps home')
    archived = home.with_name(home.name + '.rolled-back-' + bundle.name)
    if archived.exists():
        raise ValueError('Rollback archive already exists')
    home.rename(archived)
    if manifest.get('restoreSled'):
        try:
            home.mkdir(mode=0o700)
            shutil.copytree(bundle / 'userdata', home / 'userdata')
        except BaseException:
            if home.exists():
                shutil.rmtree(home)
            archived.rename(home)
            raise
    return {'preservedSledHome': str(archived), 'officialSourceUnchanged': True, 'restoredSled': bool(manifest.get('restoreSled')),
            'next': 'Use the previous binary with its restored Sled profile.' if manifest.get('restoreSled') else 'Start the unchanged official app with its original profile. Never point it at the upgraded Sled copy.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inventory', 'dry-run', 'apply', 'rollback'])
    parser.add_argument('--source', type=Path, default=LIVE)
    parser.add_argument('--home', type=Path, default=Path.home() / '.sled')
    parser.add_argument('--backup-root', type=Path, default=Path.home() / '.sled-backups')
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--source-stopped', action='store_true', help='Confirm all hosts using this profile are stopped')
    args = parser.parse_args()
    try:
        if args.action in ('inventory', 'dry-run'):
            result = inventory(args.source.expanduser().resolve())
            result['target'] = str(safe_target(args.home))
        else:
            if not args.source_stopped:
                raise ValueError('Live cutover is separate: explicitly pass --source-stopped after quitting both hosts')
            if args.action == 'apply':
                result = apply(args.source, args.home, args.backup_root)
            else:
                if not args.backup:
                    raise ValueError('Rollback requires --backup')
                result = rollback(args.backup)
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
