#!/usr/bin/env python3
"""Stage a verified Mac private release; activate only at an explicit offline cutover."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('migrate-profile.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def validate_feed(text):
    fields = {}
    for line in text.splitlines():
        if ':' in line:
            key, value = line.split(':', 1)
            fields[key.strip()] = value.strip().strip('\"\'')
    if any(fields.get(k) != v for k, v in {
            'provider': 'github', 'owner': 'SamoyedLabs', 'repo': 'sled-code'}.items()):
        raise ValueError('Artifact update feed must target SamoyedLabs/sled-code')


def stage(archive, releases):
    if sys.platform != 'darwin':
        raise ValueError('Private release verification currently requires macOS')
    archive = archive.resolve()
    releases = migration.safe_target(releases)
    if releases == archive or releases in archive.parents:
        raise ValueError('Stage outside the build output directory')
    subprocess.run(['node', str(ROOT / 'scripts/verify-desktop-package.cjs'), str(archive)], check=True)
    releases.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.staging-', dir=releases))
    try:
        subprocess.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(temporary)], check=True)
        app, = temporary.glob('*.app')
        with (app / 'Contents/Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        environment = info.get('LSEnvironment', {})
        home = migration.safe_target(environment.get('T3CODE_HOME', ''))
        if not environment.get('T3CODE_HOME') or not Path(environment['T3CODE_HOME']).is_absolute():
            raise ValueError('Private artifact must embed an absolute isolated profile')
        if environment.get('T3CODE_DISABLE_AUTO_UPDATE') != 'true':
            raise ValueError('Private releases require automatic updater disabled')
        if info['CFBundleIdentifier'] != 'com.t3tools.t3code.remote-dev':
            raise ValueError('Expected the isolated private desktop identity')
        validate_feed((app / 'Contents/Resources/app-update.yml').read_text())
        subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        signature = subprocess.run(['/usr/bin/codesign', '-dv', str(app)], capture_output=True, text=True, check=True)
        team = next((line.split('=', 1)[1] for line in signature.stderr.splitlines()
                     if line.startswith('TeamIdentifier=')), None)
        if not team or team == 'not set':
            raise ValueError('Private releases require a real local signing identity, not ad-hoc signing')
        shutil.copyfile(archive, temporary / 'desktop.zip')
        sha = digest(temporary / 'desktop.zip')
        manifest = {'schema': 1, 'repository': 'SamoyedLabs/sled-code',
                    'version': info['CFBundleShortVersionString'], 'platform': 'mac-arm64',
                    'sha256': sha, 'app': app.name, 'home': str(home),
                    'executable': info['CFBundleExecutable'], 'signingTeam': team,
                    'distribution': 'private-local; not notarized; manual activation only'}
        (temporary / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
        target = releases / sha
        if target.exists():
            raise ValueError('This release is already staged; retained without replacement')
        temporary.rename(target)
        return {'release': str(target), **manifest}
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def activate(release):
    release = release.resolve()
    manifest = json.loads((release / 'release.json').read_text())
    if digest(release / 'desktop.zip') != manifest['sha256']:
        raise ValueError('Release checksum mismatch')
    app = release / manifest['app']
    if app.parent != release or not app.name.endswith('.app'):
        raise ValueError('Invalid release app path')
    home = migration.safe_target(manifest['home'])
    if not (home / 'userdata/statev2.sqlite').is_file():
        raise ValueError('Prepare the profile with migrate-profile.py apply first')
    migration.stopped(migration.LIVE)
    migration.stopped(home)
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    if info['LSEnvironment']['T3CODE_HOME'] != str(home):
        raise ValueError('Profile metadata mismatch')
    executable = app / 'Contents/MacOS' / info['CFBundleExecutable']
    if executable.parent != app / 'Contents/MacOS':
        raise ValueError('Invalid executable path')
    signature = subprocess.run(['/usr/bin/codesign', '-dv', str(app)], capture_output=True, text=True, check=True)
    if ('TeamIdentifier=' + manifest['signingTeam']) not in signature.stderr.splitlines():
        raise ValueError('Signing team changed since staging')
    backups = migration.safe_target(home.with_name(home.name + '-release-backups'))
    backups.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='before-update-', dir=backups))
    backup.chmod(0o700)
    migration.snapshot(home / 'userdata', backup / 'userdata')
    (backup / 'manifest.json').write_text(json.dumps({
        'schema': 1, 'home': str(home), 'restoreSled': True,
        'hashes': migration.hashes(backup / 'userdata')}, indent=2) + '\n')
    migration.stopped(home)
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    env.update(info['LSEnvironment'])
    env['T3CODE_DISABLE_AUTO_UPDATE'] = 'true'
    log = home / 'private-desktop.log'
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, 'ab') as stream:
        process = subprocess.Popen([str(executable)], env=env, stdout=stream,
                                   stderr=stream, start_new_session=True)
    return {'pid': process.pid, 'log': str(log), 'release': str(release), 'backup': str(backup)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['stage', 'activate'])
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--releases', type=Path, default=Path.home() / '.sled-releases')
    parser.add_argument('--release', type=Path)
    parser.add_argument('--hosts-stopped', action='store_true')
    args = parser.parse_args()
    try:
        if args.action == 'stage':
            if not args.archive:
                raise ValueError('Stage requires --archive')
            result = stage(args.archive, args.releases)
        else:
            if not args.release or not args.hosts_stopped:
                raise ValueError('Activation requires --release and --hosts-stopped at the live cutover')
            result = activate(args.release)
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
