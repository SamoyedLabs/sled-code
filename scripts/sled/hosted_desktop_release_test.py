import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hosted', Path(__file__).with_name('hosted-desktop-release.py'))
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)

class HostedReleaseTest(unittest.TestCase):
    def test_resolve_requires_exact_main_check_and_deduplicates_drafts(self):
        sha = 'a' * 40
        def check(head=sha, conclusion='success'):
            return {'name': 'Check', 'head_sha': head, 'app': {'slug': 'github-actions'}, 'conclusion': conclusion}
        cases = [([], [], False), ([check(conclusion='failure')], [], False),
                 ([check(head='b' * 40)], [], False),
                 ([check()], [{'draft': True, 'body': 'Sled source: ' + sha}], False),
                 ([check()], [], True)]
        for checks, releases, expected in cases:
            with self.subTest(checks=checks, releases=releases), tempfile.TemporaryDirectory() as temp:
                target = Path(temp) / 'output'
                target.touch()
                with patch.dict(os.environ, {'GITHUB_RUN_NUMBER': '42', 'GITHUB_OUTPUT': str(target)}), patch.object(
                    hosted, 'api', side_effect=[{'object': {'sha': sha}}, {'check_runs': checks}, releases]):
                    hosted.resolve()
                self.assertEqual(target.read_text(), f'sha={sha}\nversion=0.2.42\n' if expected else '')

    def test_missing_cloud_credentials_fail_before_import_or_build(self):
        for platform in ['mac', 'win']:
            with self.subTest(platform=platform), patch.dict(os.environ, {}, clear=True), patch.object(hosted.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'Cloud signing/configuration not provisioned'):
                    hosted.credentials(platform)
                run.assert_not_called()

    def test_private_mac_credentials_need_only_existing_identity_and_password(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'env'
            settings = {
                'SLED_MAC_DISTRIBUTION': 'private-development', 'SLED_APPLE_TEAM_ID': 'WYW7983W9W',
                'SLED_MAC_SIGNING_REQUIREMENT': 'identifier "com.t3tools.t3code.remote-dev"',
                'CSC_LINK': base64.b64encode(b'test certificate').decode(), 'CSC_KEY_PASSWORD': 'test-password',
                'RUNNER_TEMP': temp, 'GITHUB_ENV': str(output),
                'T3CODE_RELAY_URL': 'public', 'T3CODE_CLERK_PUBLISHABLE_KEY': 'public',
                'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID': 'public', 'T3CODE_CLERK_JWT_TEMPLATE': 'public',
            }
            with patch.dict(os.environ, settings, clear=True), patch.object(hosted.subprocess, 'run'), patch.object(
                hosted, 'run', side_effect=['', '1) HASH "Apple Development: Existing Owner (ID)"']):
                hosted.credentials('mac')
            self.assertIn('CSC_NAME=Apple Development:', output.read_text())
            self.assertNotIn('APPLE_API_KEY', output.read_text())
            self.assertFalse((Path(temp) / 'sled-notary.p8').exists())
            self.assertFalse((Path(temp) / 'sled-signing.p12').exists())

    def test_publish_refuses_changed_artifacts_before_creating_draft(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'release-desktop'
            folder.mkdir()
            (folder / 'test.zip').write_bytes(b'changed')
            (folder / 'verified-mac.json').write_text(json.dumps({
                'platform': 'mac', 'version': '0.2.42', 'hashes': {'test.zip': 'wrong'},
            }))
            old = os.getcwd()
            try:
                os.chdir(temp)
                with patch.dict(os.environ, {'SLED_RELEASE_VERSION': '0.2.42', 'SLED_RELEASE_SHA': 'a' * 40}), patch.object(hosted, 'run') as run:
                    with self.assertRaisesRegex(ValueError, 'modified certified artifact'):
                        hosted.publish()
                    run.assert_not_called()
            finally:
                os.chdir(old)

if __name__ == '__main__':
    unittest.main()
