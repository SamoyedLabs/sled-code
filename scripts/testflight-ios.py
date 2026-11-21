#!/usr/bin/env python3
"""Archive the tested native iPhone app; export/upload only when explicitly selected."""
import argparse
from contextlib import nullcontext
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import threading
import time

from sled.native_build_diagnostics import publish_progress
from sled.native_signing import signing_session
from sled.native_build_cache import NativePreparation, configure_cache


def build_activity(log):
    progress = dict(activity='waiting-for-output', target=None, compileEvents=0,
                    cacheHits=0, cacheMisses=0)
    activities = {'CompileC': 'compile', 'SwiftCompile': 'compile',
                  'SwiftEmitModule': 'compile', 'SwiftDriver': 'compile',
                  'Ld': 'link', 'Libtool': 'link', 'CodeSign': 'sign',
                  'PhaseScriptExecution': 'script', 'Copy': 'package',
                  'CopySwiftLibs': 'package', 'Validate': 'validate'}
    with log.open(errors='replace') as stream:
        for line in stream:
            operation = line.split(' ', 1)[0]
            if operation in activities:
                progress['activity'] = activities[operation]
                if operation in ('CompileC', 'SwiftCompile'):
                    progress['compileEvents'] += 1
                match = re.search(r"\(in target '([A-Za-z0-9_.+ -]{1,80})'", line)
                progress['target'] = match[1] if match else None
            if line.strip() == 'Cache hit':
                progress['cacheHits'] += 1
            elif line.strip() == 'Cache miss':
                progress['cacheMisses'] += 1
    return progress


def run_logged(command, *, cwd, env, log, check=False):
    stage = log.stem
    started = time.monotonic()
    stopped = threading.Event()
    progress_file = log.with_name('native-progress.json')

    def report(status, exit_code=None):
        stat = log.stat()
        quiet = max(0, int(time.time() - stat.st_mtime))
        progress = dict(stage=stage, status=status, exitCode=exit_code,
                        updatedAt=datetime.now(timezone.utc).isoformat(),
                        elapsedSeconds=int(time.monotonic() - started),
                        logBytes=stat.st_size, quietSeconds=quiet,
                        quietWarning=status == 'running' and quiet >= 180,
                        **build_activity(log))
        print(f"[native] {stage} progress: activity={progress['activity']} "
              + json.dumps(progress), flush=True)
        publish_progress(progress, progress_file, env)

    def report_progress():
        while not stopped.wait(30):
            status = log.stat()
            print(f'[native] {stage} running: elapsed={int(time.monotonic() - started)}s '
                  f'log_bytes={status.st_size} quiet_for={max(0, int(time.time() - status.st_mtime))}s',
                  flush=True)
            report('running')

    print(f'[native] {stage} started', flush=True)
    with log.open('w') as stream:
        report('running')
        reporter = threading.Thread(target=report_progress, daemon=True)
        reporter.start()
        exit_code = 'interrupted'
        try:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=stream,
                                    stderr=subprocess.STDOUT, check=check)
            exit_code = result.returncode
            return result
        except subprocess.CalledProcessError as error:
            exit_code = error.returncode
            raise
        finally:
            stopped.set()
            reporter.join()
            record = dict(phase=stage, elapsed_seconds=round(time.monotonic() - started, 3),
                          exit_code=exit_code, source_sha=os.environ.get('CI_SOURCE_SHA') or os.environ.get('GITHUB_SHA'),
                          run_id=os.environ.get('GITHUB_RUN_ID'), run_attempt=os.environ.get('GITHUB_RUN_ATTEMPT'))
            with (log.parent / 'phase-timings.jsonl').open('a') as timings:
                timings.write(json.dumps(record) + '\n')
            report('completed' if exit_code == 0 else 'failed', exit_code)
            print(f'[native] {stage} finished: exit={exit_code} '
                  f'elapsed={int(time.monotonic() - started)}s', flush=True)


root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['archive', 'export', 'upload'])
parser.add_argument('--team', required=True)
parser.add_argument('--build-number', default='1')
parser.add_argument('--bundle-id', default='com.samoyedlabs.sled')
parser.add_argument('--unsigned', action='store_true', help='Benchmark archive compilation without signing; cannot export or upload.')
parser.add_argument('--manual-signing', action='store_true', help='Use the supplied distribution profile for the archive as well as export.')
parser.add_argument('--prepare', action='store_true', help='Apply source integration and regenerate iOS configuration.')
parser.add_argument('--skip-prebuild', action='store_true',
                    help='Reuse caller-prepared native configuration; still install Pods and resolve Swift packages.')
parser.add_argument('--enable-ota', action='store_true',
                    help='Embed a Sled-owned Expo update project in a new native archive.')
parser.add_argument('--ota-channel', help='Explicit Sled EAS channel for a new OTA-capable native archive.')
parser.add_argument('--credentials-dir', type=Path, default=root / '.tools/apple-credentials')
parser.add_argument('--public-config', type=Path, default=root / '.tools/desktop-review/connect-public-config.json')
parser.add_argument('--derived-data-path', type=Path,
                    help='Override persistent, toolchain-scoped DerivedData.')
parser.add_argument('--disable-compiler-cache', action='store_true', help='Measure a build without the compiler cache.')
parser.add_argument('--force-prepare', action='store_true', help='Regenerate native configuration even if its receipt matches.')
parser.add_argument('--tools-bin', type=Path, default=root / '.tools/bin')
parser.add_argument('--output-dir', type=Path, help='Use a distinct directory to retain previous native releases.')
args = parser.parse_args()
if args.unsigned and (args.action != 'archive' or args.manual_signing):
    parser.error('--unsigned is restricted to benchmark archives without manual signing')
if args.skip_prebuild and (args.action != 'archive' or not args.prepare):
    parser.error('--skip-prebuild requires archive --prepare')
if args.enable_ota:
    project = os.environ.get('SLED_EXPO_PROJECT_ID', '').strip()
    owner = os.environ.get('SLED_EXPO_OWNER', '').strip()
    if (not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', project)
            or project.lower() == 'd763fcb8-d37c-41ea-a773-b54a0ab4a454' or not owner):
        parser.error('--enable-ota requires your SLED_EXPO_PROJECT_ID and SLED_EXPO_OWNER; upstream is forbidden')
    if args.action != 'archive' or not args.prepare or not args.ota_channel:
        parser.error('--enable-ota requires archive --prepare --ota-channel CHANNEL; existing native builds cannot gain OTA remotely')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', args.ota_channel):
        parser.error('--ota-channel must be a simple EAS channel name')
if args.ota_channel and not args.enable_ota:
    parser.error('--ota-channel requires --enable-ota')
mobile = root / 'apps/mobile'
output = (args.output_dir or root / '.tools/testflight' / args.bundle_id).resolve()
output.mkdir(parents=True, exist_ok=True)
archive = output / 'T3CodeRemote.xcarchive'
env = dict(os.environ)
env.pop('ELECTRON_RUN_AS_NODE', None)
env.update(APP_VARIANT='preview', MOBILE_VERSION_POLICY='fingerprint',
           T3CODE_MOBILE_UPDATES_ENABLED='0', T3CODE_IOS_TEAM_ID=args.team,
           T3CODE_IOS_PERSONAL_TEAM='1', T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=args.bundle_id,
           EXPO_NO_GIT_STATUS='1', CI='1',
           PATH=str(args.tools_bin.resolve()) + os.pathsep + env.get('PATH', ''))
if args.enable_ota:
    env.update(T3CODE_MOBILE_UPDATES_ENABLED='1', SLED_EXPO_PROJECT_ID=project,
               SLED_EXPO_OWNER=owner, SLED_EXPO_CHANNEL=args.ota_channel)
api_auth_path = args.credentials_dir / 'app-store-connect.json'
api_auth = json.loads(api_auth_path.read_text()) if api_auth_path.exists() else None
api_auth_flags = []
if api_auth:
    api_auth_flags = ['-authenticationKeyPath', api_auth['privateKeyPath'],
                      '-authenticationKeyID', api_auth['keyId'],
                      '-authenticationKeyIssuerID', api_auth['issuerId']]
signing_path = args.credentials_dir / 'distribution-signing.json'
signing = json.loads(signing_path.read_text()) if signing_path.exists() else None
if signing and signing['bundleIdentifier'] != args.bundle_id:
    raise SystemExit('Local distribution profile does not match the requested bundle ID')
if args.manual_signing and not signing:
    parser.error('--manual-signing requires distribution-signing.json')
public_config = args.public_config
if not public_config.is_file():
    raise SystemExit('A validated public connection configuration is required')
if public_config.exists():
    public = json.loads(public_config.read_text())
    allowed = {'T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY', 'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_CLERK_JWT_TEMPLATE'}
    if set(public) != allowed or not all(isinstance(v, str) for v in public.values()):
        raise SystemExit('Expected only the four public connection settings')
    env.update(public)
compiler_cache_flags = []
if args.action == 'archive':
    cache = configure_cache(env, root, args.derived_data_path, args.disable_compiler_cache)
    args.derived_data_path = cache['derivedData']
    package_cache_flags, compiler_cache_flags = cache['packages'], cache['compiler']

    def native_runtime():
        resolved = subprocess.check_output(['pnpm', 'exec', 'expo-updates', 'runtimeversion:resolve',
                                           '--platform', 'ios'], cwd=mobile, env=env, text=True)
        return json.loads(resolved)['runtimeVersion']

    preparation = NativePreparation(root, env, cache['toolchain'], native_runtime)
    reused_preparation = args.prepare and not args.force_prepare and preparation.matches()
    if reused_preparation:
        print('[native] Reusing verified native preparation and Pods', flush=True)
    if args.prepare and not args.skip_prebuild and not reused_preparation:
        import sys
        subprocess.run([sys.executable, 'scripts/sled/prepare-native.py'], cwd=root, env=env, check=True)
        run_logged(['pnpm', 'exec', 'expo', 'prebuild', '--platform', 'ios', '--no-install'],
                   cwd=mobile, env=env, log=output / 'prebuild.log', check=True)
    projects = list((mobile / 'ios').glob('*.xcodeproj'))
    if len(projects) != 1:
        raise SystemExit('Expected one generated iOS application project')
    project_name = projects[0].stem
    info_path = mobile / 'ios' / project_name / 'Info.plist'
    with info_path.open('rb') as stream:
        app_info = plistlib.load(stream)
    if app_info.get('CFBundleVersion') != '$(CURRENT_PROJECT_VERSION)':
        app_info['CFBundleVersion'] = '$(CURRENT_PROJECT_VERSION)'
        with info_path.open('wb') as stream:
            plistlib.dump(app_info, stream)
    workspace = mobile / 'ios' / (project_name + '.xcworkspace')
    if (args.prepare and not reused_preparation) or not workspace.exists():
        run_logged(['pod', 'install', '--no-repo-update'], cwd=mobile / 'ios', env=env,
                   log=output / 'pods.log', check=True)
    if args.prepare and not reused_preparation:
        run_logged(['xcodebuild', '-resolvePackageDependencies', '-workspace', str(workspace),
                    '-scheme', project_name, '-derivedDataPath', str(args.derived_data_path.resolve()),
                    *package_cache_flags],
                   cwd=mobile, env=env, log=output / 'packages.log', check=True)
    command = ['xcodebuild', 'archive', '-workspace', str(workspace),
               '-scheme', project_name, '-configuration', 'Release', '-sdk', 'iphoneos',
               '-destination', 'generic/platform=iOS', '-jobs', '4',
               '-disableAutomaticPackageResolution', '-skipPackageUpdates',
               '-derivedDataPath', str(args.derived_data_path.resolve()),
               '-archivePath', str(archive), '-allowProvisioningUpdates',
               'DEVELOPMENT_TEAM=' + args.team, 'CODE_SIGN_STYLE=Automatic',
               'CURRENT_PROJECT_VERSION=' + args.build_number,
               *package_cache_flags, *compiler_cache_flags]
    if args.manual_signing:
        # Profile overrides belong on the app target; applying them to Pods breaks resource bundles.
        subprocess.run(['ruby', '-rxcodeproj', '-e',
                        'p = Xcodeproj::Project.open(ARGV[0]); changed = false; '
                        'p.targets.select { |t| t.product_type == "com.apple.product-type.application" }.each { |t| '
                        't.build_configurations.each { |c| { '
                        '"CODE_SIGN_STYLE" => "Manual", "CODE_SIGN_IDENTITY" => ARGV[1], '
                        '"PROVISIONING_PROFILE_SPECIFIER" => ARGV[2] }.each { |k,v| '
                        'if c.build_settings[k] != v; c.build_settings[k] = v; changed = true; end } } }; '
                        'p.save if changed',
                        str(projects[0]), signing['certificateSha1'], signing['profileUuid']],
                       cwd=mobile, env=env, check=True)
        command = [part for part in command if part not in ('CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates')]
    if args.unsigned:
        command = [part for part in command if part not in ('CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates')]
        command += ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=']
    if args.prepare:
        preparation.record()
else:
    if not archive.exists():
        raise SystemExit('Create the native archive first')
    with (archive / 'Info.plist').open('rb') as stream:
        metadata = plistlib.load(stream)['ApplicationProperties']
    if metadata.get('CFBundleIdentifier') != args.bundle_id or metadata.get('Team') != args.team:
        raise SystemExit('Archive identity does not match this private TestFlight target')
    options = output / ('UploadOptions.plist' if args.action == 'upload' else 'ExportOptions.plist')
    export_options = {'method': 'app-store-connect', 'destination': 'upload' if args.action == 'upload' else 'export',
                      'teamID': args.team, 'signingStyle': 'automatic', 'uploadSymbols': True,
                      'manageAppVersionAndBuildNumber': False, 'testFlightInternalTestingOnly': True}
    if signing:
        export_options.update(signingStyle='manual', signingCertificate=signing['certificateSha1'],
                              provisioningProfiles={args.bundle_id: signing['profileUuid']})
    with options.open('wb') as stream:
        plistlib.dump(export_options, stream)
    command = ['xcodebuild', '-exportArchive', '-archivePath', str(archive),
               '-exportPath', str(output / 'export'), '-exportOptionsPlist', str(options),
               '-allowProvisioningUpdates']
log = output / (args.action + '.log')
if not args.unsigned:
    command += api_auth_flags
lease = signing_session(signing, output) if signing and not args.unsigned and (args.action != 'archive' or args.manual_signing) else nullcontext()
with lease:
    result = run_logged(command, cwd=mobile, env=env, log=log)
    if args.action == 'archive' and not args.disable_compiler_cache:
        counts = {'hits': 0, 'misses': 0}
        with log.open(errors='replace') as stream:
            for line in stream:
                if line.strip() == 'Cache hit':
                    counts['hits'] += 1
                elif line.strip() == 'Cache miss':
                    counts['misses'] += 1
        (output / 'compilation-cache-statistics.json').write_text(json.dumps(counts, indent=2) + '\n')
        print('[native] compilation cache: ' + json.dumps(counts), flush=True)
print(args.action, 'exit:', result.returncode, 'log:', log)
if result.returncode == 0:
    with (archive / 'Info.plist').open('rb') as stream:
        metadata = plistlib.load(stream)['ApplicationProperties']
    if metadata.get('CFBundleIdentifier') != args.bundle_id or (not args.unsigned and metadata.get('Team') != args.team):
        raise SystemExit('Built archive identity does not match the requested TestFlight target')
    if args.action == 'archive' and metadata['CFBundleVersion'] != args.build_number:
        raise SystemExit('Archive did not embed the requested build number; do not upload')
    status_path = output / 'status.json'
    status = json.loads(status_path.read_text()) if status_path.exists() and args.action != 'archive' else {}
    status.update(benchmarkOnly=args.unsigned, updatedAt=datetime.now(timezone.utc).isoformat(), team=args.team,
                  bundleIdentifier=args.bundle_id, version=metadata['CFBundleShortVersionString'],
                  build=metadata['CFBundleVersion'], internalTestFlightOnly=True)
    status[{'archive': 'archiveSucceeded', 'export': 'appStoreExportSucceeded', 'upload': 'uploaded'}[args.action]] = True
    status_path.write_text(json.dumps(status, indent=2) + '\n')
raise SystemExit(result.returncode)
