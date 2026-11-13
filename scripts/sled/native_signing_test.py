"""Signing failures and cancellation must not leave private keychains unlocked."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from native_signing import settings_flags, signing_session


class SigningTest(unittest.TestCase):
    def test_restores_keychain_when_preflight_fails_or_build_is_cancelled(self):
        for failure in ('probe', 'timeout', 'build', 'interrupt'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                password = root / 'password'
                password.write_text('private-fixture-password')
                signing = dict(keychainPath=str(root / 'distribution.keychain-db'),
                               passwordFile=str(password), certificateSha1='A' * 40)
                state = dict(timeout=300, locked=True, search=['original.keychain-db'])

                def security(command, **kwargs):
                    if command[0] == 'codesign':
                        if failure == 'timeout':
                            raise subprocess.TimeoutExpired(command, 20)
                        if failure == 'probe':
                            return subprocess.CompletedProcess(command, 1, '', 'secret certificate diagnostic')
                    if command[:2] == ['security', 'unlock-keychain']:
                        state['locked'] = False
                    elif command[:2] == ['security', 'lock-keychain']:
                        state['locked'] = True
                    elif command[:2] == ['security', 'show-keychain-info']:
                        return subprocess.CompletedProcess(command, 0, '', 'Keychain "fixture" lock-on-sleep timeout=300s')
                    elif command[:2] == ['security', 'set-keychain-settings']:
                        state['timeout'] = int(command[command.index('-t') + 1])
                    elif command[:2] == ['security', 'list-keychains']:
                        state['search'] = command[5:]
                    return subprocess.CompletedProcess(command, 0, '', '')

                error = KeyboardInterrupt if failure == 'interrupt' else RuntimeError
                with patch('subprocess.run', side_effect=security), \
                        patch('subprocess.check_output', return_value='"original.keychain-db"'), \
                        self.assertRaises(error) as raised:
                    with signing_session(signing, root):
                        self.assertFalse(state['locked'])
                        self.assertEqual(state['timeout'], 21600)
                        if failure == 'interrupt':
                            raise KeyboardInterrupt()
                        raise RuntimeError('build failed')
                self.assertEqual(state, dict(timeout=300, locked=True, search=['original.keychain-db']))
                self.assertNotIn('private-fixture-password', str(raised.exception))
                self.assertNotIn('secret certificate diagnostic', str(raised.exception))

    def test_settings_without_timeout_or_sleep_lock_are_preserved(self):
        self.assertEqual(settings_flags('Keychain "fixture" no-timeout'), [])
        self.assertEqual(settings_flags('Keychain "fixture" timeout=7200s'), ['-u', '-t', '7200'])


if __name__ == '__main__':
    unittest.main()
