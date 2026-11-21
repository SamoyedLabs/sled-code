#!/usr/bin/env python3
"""Focused hosted release safety/decision tests; no network, signing or publishing."""
import importlib.util
import contextlib
import io
import json
import os
import plistlib
import runpy
import shutil
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mobile_release', Path(__file__).with_name('hosted-mobile-release.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def baseline():
    return dict(bundleIdentifier=m.BUNDLE, team=m.TEAM, projectId=m.PROJECT, channel=m.CHANNEL,
                signatureVerified=True, appStoreProfile=True, embeddedJS=True, webRTC=True,
                uploaded=True, runtimeVersion='a' * 40, sourceSha='b' * 40,
                ipaSha256='c' * 64, build='2', version='2.2.0')


class MobileReleaseTest(unittest.TestCase):
    def test_local_ota_plan_selects_by_runtime_without_export_or_publication(self):
        for runtime, plan in [('a' * 40, True), ('b' * 40, True), ('b' * 40, False)]:
            with self.subTest(runtime=runtime, plan=plan), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                archive = root / 'App.xcarchive'
                app = archive / 'Products/Applications/Sled.app'
                app.mkdir(parents=True)
                (app / 'Info.plist').write_bytes(plistlib.dumps(dict(
                    CFBundleIdentifier=m.BUNDLE, CFBundleVersion='6')))
                (app / 'Expo.plist').write_bytes(plistlib.dumps(dict(
                    EXUpdatesEnabled=True, EXUpdatesURL='https://u.expo.dev/' + m.PROJECT,
                    EXUpdatesRequestHeaders={'expo-channel-name': m.CHANNEL},
                    EXUpdatesRuntimeVersion='a' * 40)))
                public = root / 'public.json'
                public.write_text(json.dumps({key: 'fixture' for key in m.PUBLIC}))
                argv = ['ota-ios.py', '--archive', str(archive), '--public-config', str(public),
                        '--plan' if plan else '--export']
                def resolve(command, **kwargs):
                    self.assertEqual(command[:4], ['pnpm', 'exec', 'expo-updates', 'runtimeversion:resolve'])
                    return subprocess.CompletedProcess(command, 0, stdout=json.dumps({'runtimeVersion': runtime}))
                stream = io.StringIO()
                with patch.object(sys, 'argv', argv), patch.object(subprocess, 'run', side_effect=resolve), \
                        contextlib.redirect_stdout(stream):
                    if plan:
                        runpy.run_path(str(m.ROOT / 'scripts/sled/ota-ios.py'), run_name='__main__')
                        value = json.loads(stream.getvalue())
                        self.assertEqual(value['mode'], 'ota' if runtime == 'a' * 40 else 'native')
                    else:
                        with self.assertRaisesRegex(SystemExit, 'Native build needed'):
                            runpy.run_path(str(m.ROOT / 'scripts/sled/ota-ios.py'), run_name='__main__')

    def test_resolve_skips_released_commits_and_blocks_unresolved_uploads_without_native_setup(self):
        sha = 'd' * 40
        for items, expected in [([], sha), ([{'tag_name': 'sled-mobile-' + sha, 'draft': False}], ''),
                                ([{'tag_name': 'sled-mobile-' + sha, 'draft': True}], None),
                                ([{'tag_name': 'sled-mobile-' + 'e' * 40, 'draft': True}], None)]:
            with self.subTest(items=items), tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / 'output'
                output.touch()
                with patch.dict(os.environ, GITHUB_OUTPUT=str(output)), \
                        patch.object(m, 'checked_main', return_value=sha), \
                        patch.object(m, 'releases', return_value=items), \
                        patch.object(m, 'configure') as configure, patch.object(m, 'prepare_runtime') as prepare:
                    if expected is None:
                        with self.assertRaisesRegex(ValueError, 'reconcile'):
                            m.resolve()
                    else:
                        m.resolve()
                    self.assertEqual(output.read_text(), f'sha={sha}\n' if expected else '')
                    configure.assert_not_called()
                    prepare.assert_not_called()

    def test_native_diagnostics_redact_credentials_and_retain_error_context(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            credentials = folder / 'credentials'
            credentials.mkdir()
            (credentials / 'keychain-password').write_text('generated-keychain-secret')
            (folder / 'archive.log').write_text(
                'normal build output\n' * 1000 +
                'error: signing failed with secret-fixture and generated-keychain-secret\n'
                '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----\n'
                'Authorization: Bearer bearer-fixture\n' + 'A' * 200 + '\n' +
                ('clang -Werror=return-type source.m\ninternal class GenericError {}\n' * 400))
            m.retain_errors(folder, {'SLED_EXPO_TOKEN': 'secret-fixture'}, credentials)
            text = (folder / 'archive-diagnostics.json').read_text()
            for secret in ('secret-fixture', 'generated-keychain-secret', 'private-material', 'bearer-fixture', 'A' * 120):
                self.assertNotIn(secret, text)
            self.assertIn('signing failed', text)
            self.assertLessEqual(len(json.loads(text)['excerpts']), 240)

    def test_eas_environment_cannot_change_validated_runtime_or_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / 'environment.json'
            manifest.write_text(json.dumps(dict(runtimeVersion='a' * 40,
                                                environment={'SLED_EXPO_PROJECT_ID': m.PROJECT})))
            with patch.dict(os.environ, SLED_EXPO_PROJECT_ID='upstream'), patch.object(m, 'runtime') as runtime:
                with self.assertRaisesRegex(ValueError, 'configuration'):
                    m.check_environment(manifest)
                runtime.assert_not_called()
            with patch.dict(os.environ, SLED_EXPO_PROJECT_ID=m.PROJECT), patch.object(m, 'runtime', return_value='b' * 40):
                with self.assertRaisesRegex(ValueError, 'runtime'):
                    m.check_environment(manifest)

    def test_manual_signing_is_opt_in_and_does_not_apply_profiles_to_pods(self):
        for manual, exit_code, prepared, unsigned, publication_failed in (
                (False, 0, False, False, False), (True, 0, False, False, False),
                (True, 65, True, False, False), (False, 0, True, True, False),
                (True, 0, True, False, True)):
            with self.subTest(manual=manual, exit_code=exit_code, prepared=prepared, unsigned=unsigned, publication_failed=publication_failed), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                script = root / 'scripts/testflight-ios.py'
                script.parent.mkdir()
                shutil.copyfile(m.ROOT / 'scripts/testflight-ios.py', script)
                (script.parent / 'sled').mkdir()
                shutil.copyfile(m.ROOT / 'scripts/sled/native_build_diagnostics.py',
                                script.parent / 'sled/native_build_diagnostics.py')
                shutil.copyfile(m.ROOT / 'scripts/sled/native_signing.py',
                                script.parent / 'sled/native_signing.py')
                shutil.copyfile(m.ROOT / 'scripts/sled/native_build_cache.py',
                                script.parent / 'sled/native_build_cache.py')
                ios = root / 'apps/mobile/ios'
                (ios / 'App.xcodeproj').mkdir(parents=True)
                (ios / 'App.xcworkspace').mkdir()
                (ios / 'App').mkdir()
                (ios / 'App/Info.plist').write_bytes(plistlib.dumps({}))
                output = root / 'release'
                archive = output / 'T3CodeRemote.xcarchive'
                archive.mkdir(parents=True)
                (archive / 'Info.plist').write_bytes(plistlib.dumps({'ApplicationProperties': dict(
                    CFBundleIdentifier=m.BUNDLE, Team=m.TEAM, CFBundleVersion='3', CFBundleShortVersionString='2.2.0')}))
                credentials = root / 'credentials'
                credentials.mkdir()
                password = credentials / 'password'
                password.write_text('fixture')
                (credentials / 'distribution-signing.json').write_text(json.dumps(dict(
                    bundleIdentifier=m.BUNDLE, certificateSha1='C' * 40, profileUuid='profile-fixture',
                    passwordFile=str(password), keychainPath=str(credentials / 'signing.keychain'))))
                public = root / 'public.json'
                public.write_text(json.dumps({k: 'fixture' for k in m.PUBLIC}))
                argv = [str(script), 'archive', '--team', m.TEAM, '--build-number', '3',
                        '--output-dir', str(output), '--credentials-dir', str(credentials), '--public-config', str(public)]
                if unsigned:
                    argv.append('--unsigned')
                if manual:
                    argv.append('--manual-signing')
                if prepared:
                    argv.extend(['--prepare', '--skip-prebuild'])
                keychain_timeout = 300
                def fake_run(command, **kwargs):
                    nonlocal keychain_timeout
                    if command[:2] == ['security', 'show-keychain-info']:
                        return subprocess.CompletedProcess(command, 0, stdout='',
                            stderr='Keychain "fixture" lock-on-sleep timeout=300s\n')
                    if command[:2] == ['security', 'set-keychain-settings']:
                        keychain_timeout = int(command[command.index('-t') + 1])
                    if publication_failed and command[:3] == ['gh', 'release', 'upload']:
                        raise subprocess.TimeoutExpired(command, 10)
                    if command[:2] == ['xcodebuild', 'archive']:
                        kwargs['stdout'].write("CompileC object.o source.m (in target 'RNReanimated' from project 'Pods')\n"
                                               "Cache miss\nAuthorization: Bearer signing-secret\n"
                                               "profile-fixture " + 'C' * 40 + "\n")
                        kwargs['stdout'].flush()
                        # A six-minute compile reaches signing after the default keychain
                        # timeout. Model that OS transition without a wall-clock wait.
                        if manual and not unsigned and keychain_timeout <= 360:
                            return subprocess.CompletedProcess(command, 65)
                    return subprocess.CompletedProcess(command, exit_code if command[:2] == ['xcodebuild', 'archive'] else 0)

                with patch.dict(os.environ, SLED_MOBILE_PROGRESS_TAG='sled-mobile-' + 'd' * 40,
                                SLED_IOS_CACHE_ROOT=str(root / 'cache')), \
                        patch.object(sys, 'path', [str(script.parent), *sys.path]), \
                        patch.object(sys, 'argv', argv), patch.object(subprocess, 'run', side_effect=fake_run) as commands, \
                        patch.object(subprocess, 'check_output', side_effect=lambda command, **kw:
                            'Xcode fixture' if command[0] in ('xcodebuild', 'xcrun') else ''), patch('builtins.print') as printed, \
                        patch('threading.Thread') as reporter, patch('threading.Event.wait', side_effect=[False, True] * 3):
                    reporter.return_value.start.side_effect = lambda: reporter.call_args.kwargs['target']()
                    with self.assertRaises(SystemExit) as result:
                        runpy.run_path(str(script), run_name='__main__')
                    self.assertEqual(result.exception.code, exit_code)
                self.assertEqual(keychain_timeout, 300)
                console = '\n'.join(' '.join(map(str, call.args)) for call in printed.call_args_list)
                self.assertIn('[native] archive started', console)
                self.assertIn('[native] archive running:', console)
                self.assertIn('activity=', console)
                progress_text = (output / 'native-progress.json').read_text()
                progress = json.loads(progress_text)
                timings = [json.loads(line) for line in (output / 'phase-timings.jsonl').read_text().splitlines()]
                archive_timing = next(record for record in timings if record['phase'] == 'archive')
                self.assertEqual(archive_timing['exit_code'], exit_code)
                self.assertEqual(progress['stage'], 'archive')
                self.assertEqual(progress['status'], 'failed' if exit_code else 'completed')
                self.assertEqual(progress['activity'], 'compile')
                self.assertEqual(progress['target'], 'RNReanimated')
                self.assertEqual(progress['compileEvents'], 1)
                self.assertEqual(progress['cacheMisses'], 1)
                for secret in ('signing-secret', 'profile-fixture', 'C' * 40):
                    self.assertNotIn(secret, progress_text + console)
                published = [call for call in commands.call_args_list
                             if call.args[0][:3] == ['gh', 'release', 'upload']]
                self.assertTrue(published)
                if publication_failed:
                    self.assertIn('Live progress upload unavailable; build continues', console)
                self.assertTrue(all(str(output.resolve() / 'native-progress.json') in call.args[0]
                                    and '--clobber' in call.args[0] for call in published))
                self.assertIn(f'[native] archive finished: exit={exit_code}', console)
                if exit_code:
                    self.assertFalse((output / 'status.json').exists())
                self.assertNotIn('certificateSha1', console)
                self.assertNotIn('profile-fixture', console)
                self.assertNotIn('C' * 40, console)
                actual = [call.args[0] for call in commands.call_args_list]
                build_call = next(call for call in commands.call_args_list if call.args[0][:2] == ['xcodebuild', 'archive'])
                self.assertEqual(build_call.kwargs['env']['APP_VARIANT'], 'preview')
                build = build_call.args[0]
                self.assertIn('COMPILATION_CACHE_ENABLE_CACHING=YES', build)
                self.assertEqual('CODE_SIGN_STYLE=Automatic' in build, not manual and not unsigned)
                self.assertEqual('CODE_SIGNING_ALLOWED=NO' in build, unsigned)
                self.assertFalse(any(part.startswith('PROVISIONING_PROFILE_SPECIFIER=') for part in build))
                self.assertEqual(any(command[0] == 'ruby' for command in actual), manual)
                self.assertEqual(any(command[:2] == ['security', 'unlock-keychain'] for command in actual), manual)
                if prepared:
                    self.assertTrue(any(command[:2] == ['pod', 'install'] for command in actual))
                    self.assertTrue(any(command[:2] == ['xcodebuild', '-resolvePackageDependencies'] for command in actual))
                    self.assertFalse(any('prebuild' in command for command in actual))
                    self.assertFalse(any('scripts/sled/prepare-native.py' in command for command in actual))

    def test_released_commit_is_skipped_and_interrupted_draft_blocks_retry(self):
        sha = 'd' * 40
        for draft in (False, True):
            with self.subTest(draft=draft), tempfile.TemporaryDirectory() as temp, \
                    patch.object(m, 'ROOT', Path(temp)), patch.object(m, 'checked_main', return_value=sha), \
                    patch.object(m, 'configure'), patch.object(m, 'gh') as gh, \
                    patch.object(m, 'releases', return_value=[dict(tag_name='sled-mobile-' + sha, draft=draft)]):
                if draft:
                    with self.assertRaisesRegex(ValueError, 'reconcile'):
                        m.release()
                else:
                    m.release()
                gh.assert_not_called()

    def test_missing_expo_token_blocks_ota_before_reserving_external_release(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {}, clear=True), \
                patch.object(m, 'ROOT', Path(temp)), patch.object(m, 'checked_main', return_value='d' * 40), \
                patch.object(m, 'configure'), patch.object(m, 'releases', return_value=[]), \
                patch.object(m, 'baseline_from_releases', return_value=baseline()), \
                patch.object(m, 'run'), patch.object(m, 'runtime', return_value='a' * 40), \
                patch.object(m, 'gh') as gh:
            with self.assertRaisesRegex(ValueError, 'dedicated SLED_EXPO_TOKEN'):
                m.release()
            gh.assert_not_called()

    def test_plan_selects_cache_path_without_reserving_or_signing_a_release(self):
        for runtime, expected in [('a' * 40, 'ota'), ('c' * 40, 'native')]:
            with self.subTest(mode=expected), tempfile.TemporaryDirectory() as temp, \
                    patch.object(m, 'ROOT', Path(temp)), patch.object(m, 'checked_main', return_value='d' * 40), \
                    patch.object(m, 'configure') as configure, patch.object(m, 'releases', return_value=[]), \
                    patch.object(m, 'baseline_from_releases', return_value=baseline()), \
                    patch.object(m, 'run'), patch.object(m, 'runtime', return_value=runtime), \
                    patch.object(m, 'gh') as gh, patch.object(m, 'signing') as signing:
                self.assertEqual(m.plan(), expected)
                recorded = json.loads((Path(temp) / 'release-mobile/plan.json').read_text())
                self.assertEqual(recorded['sourceSha'], 'd' * 40)
                self.assertEqual(recorded['runtimeVersion'], runtime)
                configure.assert_called_once_with(require_signing=False)
                gh.assert_not_called()
                signing.assert_not_called()

    def test_prepared_runtime_is_recomputed_before_reuse(self):
        for actual in ['a' * 40, 'c' * 40]:
            with self.subTest(runtime=actual), tempfile.TemporaryDirectory() as temp, \
                    patch.object(m, 'run') as run, patch.object(m, 'runtime', return_value=actual) as runtime:
                output = Path(temp)
                (output / 'plan.json').write_text(json.dumps(dict(sourceSha='d' * 40, runtimeVersion='a' * 40)))
                if actual == 'a' * 40:
                    self.assertEqual(m.prepare_runtime('d' * 40, output, reuse=True), actual)
                else:
                    with self.assertRaisesRegex(ValueError, 'runtime changed'):
                        m.prepare_runtime('d' * 40, output, reuse=True)
                runtime.assert_called_once()
                run.assert_not_called()
                with self.assertRaisesRegex(ValueError, 'another commit'):
                    m.prepare_runtime('e' * 40, output, reuse=True)

    def test_planning_does_not_need_native_signing_credentials(self):
        settings = {key: 'fixture' for key in m.PUBLIC}
        settings['SLED_APPLE_TEAM_ID'] = m.TEAM
        with patch.dict(os.environ, settings, clear=True):
            m.configure(require_signing=False)
            self.assertEqual(os.environ['APP_VARIANT'], 'preview')
            with self.assertRaisesRegex(ValueError, 'Missing release settings'):
                m.configure()

    def test_ota_release_works_without_native_signing_credentials(self):
        settings = {key: 'fixture' for key in m.PUBLIC}
        settings.update(SLED_APPLE_TEAM_ID=m.TEAM, SLED_EXPO_TOKEN='fixture-token')
        for mode_runtime in ('a' * 40, 'c' * 40):
            with self.subTest(runtime=mode_runtime), tempfile.TemporaryDirectory() as temp, \
                    patch.dict(os.environ, settings, clear=True), patch.object(m, 'ROOT', Path(temp)), \
                    patch.object(m, 'checked_main', return_value='d' * 40), patch.object(m, 'releases', return_value=[]), \
                    patch.object(m, 'baseline_from_releases', return_value=baseline()), \
                    patch.object(m, 'prepare_runtime', return_value=mode_runtime), patch.object(m, 'runtime', return_value=mode_runtime), \
                    patch.object(m, 'gh') as gh, patch.object(m, 'signing') as signing, \
                    patch.object(m, 'run', return_value=json.dumps([dict(platform='ios', runtimeVersion=mode_runtime)])):
                if mode_runtime == 'a' * 40:
                    m.release()
                    self.assertEqual(json.loads((Path(temp) / 'release-mobile/plan.json').read_text())['mode'], 'ota')
                else:
                    with self.assertRaisesRegex(ValueError, 'Missing release settings'):
                        m.release()
                    gh.assert_not_called()
                signing.assert_not_called()

    def test_matching_runtime_uses_ota(self):
        self.assertEqual(m.decide('a' * 40, baseline()), 'ota')

    def test_native_change_requires_new_binary(self):
        self.assertEqual(m.decide('d' * 40, baseline()), 'native')

    def test_baseline_requires_all_verified_identity_fields(self):
        for key in baseline():
            if key == 'version':
                continue
            value = baseline()
            del value[key]
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.validate_baseline(value)
        for key in ('projectId', 'bundleIdentifier', 'channel', 'team'):
            value = baseline()
            value[key] = 'upstream'
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.validate_baseline(value)

    def test_runtime_override_is_not_accepted_as_fingerprint(self):
        with self.assertRaises(ValueError):
            m.decide('file:fingerprint', baseline())

    def test_no_baseline_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'Missing verified'):
            m.baseline_from_releases([], Path('/unused'))

    def test_latest_verified_native_baseline_excludes_drafts_and_ota(self):
        items = [dict(tag_name='sled-ios-native-2', draft=False),
                 dict(tag_name='sled-ios-native-3', draft=True),
                 dict(tag_name='sled-mobile-' + 'f' * 40, draft=False)]
        with tempfile.TemporaryDirectory() as temp, patch.object(m, 'gh') as gh:
            path = Path(temp)
            (path / 'baseline.json').write_text(json.dumps(baseline()))
            self.assertEqual(m.baseline_from_releases(items, path)['build'], '2')
            self.assertEqual(gh.call_args.args[2], 'sled-ios-native-2')

    def test_baseline_tag_must_match_build(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(m, 'gh'):
            path = Path(temp)
            (path / 'baseline.json').write_text(json.dumps(baseline()))
            with self.assertRaisesRegex(ValueError, 'tag/build'):
                m.baseline_from_releases([dict(tag_name='sled-ios-native-3', draft=False)], path)

    def test_untrusted_branch_or_repository_cannot_release(self):
        for repo, ref in [(m.REPO, 'refs/heads/feature'), ('someone/fork', 'refs/heads/main')]:
            with patch.dict(os.environ, GITHUB_REPOSITORY=repo, GITHUB_REF=ref), patch.object(m, 'api') as api:
                with self.assertRaisesRegex(ValueError, 'trusted main'):
                    m.checked_main()
                api.assert_not_called()

    def test_failed_check_and_stale_checkout_rejected(self):
        with patch.dict(os.environ, GITHUB_REPOSITORY=m.REPO, GITHUB_REF='refs/heads/main'), \
                patch.object(m, 'api', return_value={'sha': 'b' * 40}), \
                patch.object(m, 'run', return_value='b' * 40), \
                patch.object(m, 'gh', return_value=json.dumps([{'check_runs': [dict(name='Check', app={'slug': 'github-actions'}, id=1, conclusion='failure')]}])):
            with self.assertRaisesRegex(ValueError, 'successful'):
                m.checked_main()
        with patch.dict(os.environ, GITHUB_REPOSITORY=m.REPO, GITHUB_REF='refs/heads/main'), \
                patch.object(m, 'api', return_value={'sha': 'b' * 40}), \
                patch.object(m, 'run', return_value='c' * 40):
            with self.assertRaisesRegex(ValueError, 'current main'):
                m.checked_main()

    def test_configuration_reconstructs_identity_without_exporting_oauth(self):
        settings = {k: 'fixture' for k in (*m.PUBLIC, *m.SECRETS[:-1])}
        settings.update(SLED_APPLE_TEAM_ID=m.TEAM, EXPO_UPDATES_FINGERPRINT_OVERRIDE='wrong')
        with patch.dict(os.environ, settings, clear=True):
            m.configure()
            self.assertEqual(os.environ['SLED_EXPO_PROJECT_ID'], m.PROJECT)
            self.assertEqual(os.environ['MOBILE_VERSION_POLICY'], 'fingerprint')
            self.assertEqual(os.environ['APP_VARIANT'], 'preview')
            self.assertNotIn('EXPO_UPDATES_FINGERPRINT_OVERRIDE', os.environ)
            self.assertNotIn('EXPO_TOKEN', os.environ)

    def test_uploaded_status_cannot_substitute_for_actual_ipa_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            (path / 'export').mkdir()
            (path / 'export/Sled.ipa').write_bytes(b'fixture')
            (path / 'status.json').write_text(json.dumps(dict(archiveSucceeded=True,
                appStoreExportSucceeded=True, uploaded=False, build='2', bundleIdentifier=m.BUNDLE, team=m.TEAM)))
            with patch.object(m, 'verify', return_value=baseline()):
                with self.assertRaisesRegex(ValueError, 'upload evidence'):
                    m.evidence(path, 'b' * 40)


if __name__ == '__main__':
    unittest.main()
