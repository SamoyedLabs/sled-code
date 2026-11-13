"""Lease the configured distribution keychain for one build, then restore it."""
from contextlib import contextmanager
import fcntl
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile


def private_run(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Private signing preflight timed out; refusing an interactive signing build') from None
    if result.returncode:
        raise RuntimeError('Private signing operation failed; output and credentials suppressed')
    return (result.stdout or '') + (result.stderr or '')


def settings_flags(text):
    flags = ['-l'] if re.search(r'(?<!no-)lock-on-sleep', text) else []
    timeout = re.search(r'(?<!no-)timeout=(\d+)s', text)
    if timeout:
        flags.extend(['-u', '-t', timeout[1]])
    elif 'no-timeout' not in text:
        raise RuntimeError('Cannot read the private keychain timeout; refusing to change it')
    return flags


@contextmanager
def signing_session(signing, output):
    keychain = Path(signing['keychainPath']).resolve()
    if keychain.name in ('login.keychain', 'login.keychain-db', 'System.keychain'):
        raise RuntimeError('Build signing requires a dedicated distribution keychain')
    with keychain.with_name(keychain.name + '.build.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another build is using the private distribution keychain') from None
        # Never include the password-bearing argv in an exception or a build log.
        password = Path(signing['passwordFile']).read_text()
        previous = shlex.split(subprocess.check_output(
            ['security', 'list-keychains', '-d', 'user'], text=True))
        original = None
        try:
            private_run(['security', 'unlock-keychain', '-p', password, str(keychain)])
            original = settings_flags(private_run(['security', 'show-keychain-info', str(keychain)]))
            sleep = ['-l'] if '-l' in original else []
            private_run(['security', 'set-keychain-settings', *sleep, '-u', '-t', '21600', str(keychain)])
            private_run(['security', 'list-keychains', '-d', 'user', '-s', str(keychain),
                         *[item for item in previous if Path(item).resolve() != keychain]])
            # Exercise the private key before spending minutes compiling. The probe is
            # never executed and its signature is confined to this temporary copy.
            with tempfile.TemporaryDirectory(prefix='signing-probe-', dir=output) as directory:
                probe = Path(directory) / 'probe'
                shutil.copyfile('/usr/bin/true', probe)
                probe.chmod(0o700)
                private_run(['codesign', '--force', '--keychain', str(keychain),
                             '--sign', signing['certificateSha1'], '--timestamp=none', str(probe)])
            yield
        finally:
            failures = []
            commands = []
            if original is not None:
                commands.append(['security', 'set-keychain-settings', *original, str(keychain)])
            commands.extend([
                ['security', 'list-keychains', '-d', 'user', '-s', *previous],
                ['security', 'lock-keychain', str(keychain)],
            ])
            for command in commands:
                try:
                    private_run(command)
                except RuntimeError as error:
                    failures.append(str(error))
            if failures:
                raise RuntimeError('Could not fully restore the private signing keychain') from None
