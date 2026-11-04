#!/usr/bin/env python3
"""Focused hosted release safety/decision tests; no network, signing or publishing."""
import importlib.util
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
        for manual, exit_code, prepared in ((False, 0, False), (True, 0, False), (True, 65, True)):
            with self.subTest(manual=manual, exit_code=exit_code, prepared=prepared), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                script = root / 'scripts/testflight-ios.py'
                script.parent.mkdir()
                shutil.copyfile(m.ROOT / 'scripts/testflight-ios.py', script)
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
                if manual:
                    argv.append('--manual-signing')
                if prepared:
                    argv.extend(['--prepare', '--skip-prebuild'])
                with patch.object(sys, 'argv', argv), patch.object(subprocess, 'run', side_effect=lambda command, **kwargs: subprocess.CompletedProcess(command, exit_code if command[:2] == ['xcodebuild', 'archive'] else 0)) as commands, \
                        patch.object(subprocess, 'check_output', return_value=''), patch('builtins.print') as printed, \
                        patch('threading.Thread') as reporter, patch('threading.Event.wait', side_effect=[False, True] * 3):
                    reporter.return_value.start.side_effect = lambda: reporter.call_args.kwargs['target']()
                    with self.assertRaises(SystemExit) as result:
                        runpy.run_path(str(script), run_name='__main__')
                    self.assertEqual(result.exception.code, exit_code)
                console = '\n'.join(' '.join(map(str, call.args)) for call in printed.call_args_list)
                self.assertIn('[native] archive started', console)
                self.assertIn('[native] archive running:', console)
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
                self.assertEqual('CODE_SIGN_STYLE=Automatic' in build, not manual)
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
