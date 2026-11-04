import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = load('migrate-profile')
release = load('private-release')


class MigrationTest(unittest.TestCase):
    def test_copy_preserves_threads_settings_paths_and_rollback_leaves_source_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source = base / 'official/userdata'
            source.mkdir(parents=True)
            with sqlite3.connect(source / 'statev2.sqlite') as db:
                db.execute('create table threads(id text, project_path text)')
                db.execute('insert into threads values (?, ?)', ('thread-1', '/original/project'))
            (source / 'settings.json').write_text('{"theme":"dark"}')
            before = migration.hashes(source)
            with patch.object(migration, 'stopped') as stopped:
                result = migration.apply(source, base / 'sled', base / 'backups')
                self.assertEqual(stopped.call_count, 2)
                self.assertEqual(migration.hashes(source), before)
                with sqlite3.connect(base / 'sled/userdata/statev2.sqlite') as db:
                    self.assertEqual(db.execute('select * from threads').fetchall(),
                                     [('thread-1', '/original/project')])
                    db.execute('delete from threads')
                self.assertEqual((base / 'sled/userdata/settings.json').read_text(), '{"theme":"dark"}')
                rollback = migration.rollback(result['backup'])
                self.assertFalse((base / 'sled').exists())
                self.assertTrue(Path(rollback['preservedSledHome']).exists())
                self.assertEqual(migration.hashes(source), before)

    def test_running_host_and_existing_destination_are_refused_without_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source = base / 'source'
            source.mkdir()
            with patch.object(migration, 'stopped', side_effect=ValueError('running host')):
                with self.assertRaisesRegex(ValueError, 'running host'):
                    migration.apply(source, base / 'sled', base / 'backups')
            self.assertFalse((base / 'backups').exists())
            (base / 'sled').mkdir()
            with self.assertRaisesRegex(ValueError, 'must not exist'):
                migration.apply(source, base / 'sled', base / 'backups')

    def test_live_target_symlink_and_backup_tampering_are_refused(self):
        with self.assertRaises(ValueError):
            migration.safe_target(migration.LIVE / 'nested')
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source = base / 'source'
            source.mkdir()
            (source / 'settings.json').write_text('{}')
            (source / 'link').symlink_to(source / 'settings.json')
            with self.assertRaisesRegex(ValueError, 'Symlinks'):
                migration.inventory(source)
            (source / 'link').unlink()
            with patch.object(migration, 'stopped'):
                result = migration.apply(source, base / 'sled', base / 'backups')
            (Path(result['backup']) / 'userdata/settings.json').write_text('tampered')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                migration.rollback(result['backup'])
            self.assertTrue((base / 'sled').exists())

    def test_stage_validates_final_archive_and_isolated_identity_before_activation(self):
        import plistlib
        import shutil
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            archive = base / 'desktop.zip'
            archive.write_bytes(b'fixture archive; extraction and codesign are mocked')
            fixture = base / 'fixture.app'
            resources = fixture / 'Contents/Resources'
            resources.mkdir(parents=True)
            info = {
                'CFBundleIdentifier': 'com.t3tools.t3code.remote-dev',
                'CFBundleShortVersionString': '1.0.0', 'CFBundleExecutable': 'Sled',
                'LSEnvironment': {'T3CODE_HOME': str(base / 'home'),
                                  'T3CODE_DISABLE_AUTO_UPDATE': 'true'}}
            (fixture / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
            feed = resources / 'app-update.yml'
            feed.write_text('provider: github\nowner: SamoyedLabs\nrepo: sled-code\n')

            def command(args, **kwargs):
                if args[0] == '/usr/bin/ditto':
                    shutil.copytree(fixture, Path(args[-1]) / 'Sled.app')
                return SimpleNamespace(stderr='TeamIdentifier=FIXTURE\n', returncode=0)

            with patch.object(release.sys, 'platform', 'darwin'), patch.object(release.subprocess, 'run', side_effect=command):
                result = release.stage(archive, base / 'releases')
                self.assertEqual(result['sha256'], release.digest(archive))
                self.assertTrue((Path(result['release']) / 'desktop.zip').is_file())
                self.assertFalse((base / 'home').exists())
                feed.write_text('provider: github\nowner: pingdotgg\nrepo: t3code\n')
                with self.assertRaisesRegex(ValueError, 'update feed'):
                    release.stage(archive, base / 'rejected')
                self.assertEqual(list((base / 'rejected').iterdir()), [])

    def test_feed_must_be_sled_owned(self):
        release.validate_feed('provider: github\nowner: SamoyedLabs\nrepo: sled-code\n')
        with self.assertRaises(ValueError):
            release.validate_feed('provider: github\nowner: pingdotgg\nrepo: t3code\n')

    def test_update_rollback_restores_backup_and_preserves_newer_data(self):
        import json
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            home = base / 'sled'
            (home / 'userdata').mkdir(parents=True)
            (home / 'userdata/settings.json').write_text('old')
            backup = base / 'backup'
            backup.mkdir()
            migration.snapshot(home / 'userdata', backup / 'userdata')
            (backup / 'manifest.json').write_text(json.dumps({
                'home': str(home), 'restoreSled': True,
                'hashes': migration.hashes(backup / 'userdata')}))
            (home / 'userdata/settings.json').write_text('new')
            with patch.object(migration, 'stopped'):
                result = migration.rollback(backup)
            self.assertTrue(result['restoredSled'])
            self.assertEqual((home / 'userdata/settings.json').read_text(), 'old')
            self.assertEqual((Path(result['preservedSledHome']) / 'userdata/settings.json').read_text(), 'new')

    def test_real_running_fixture_host_is_refused(self):
        import os
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            if os.name == 'nt':
                with self.assertRaisesRegex(ValueError, 'Windows apply is not verified'):
                    migration.stopped(source)
                return
            child = subprocess.Popen([
                sys.executable, '-c',
                "import sys; f=open(sys.argv[1], 'w'); print('ready', flush=True); input(); f.close()",
                str(source / 'host-open-file')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), 'ready')
                with self.assertRaisesRegex(ValueError, 'Profile may be open|lsof is required'):
                    migration.stopped(source)
            finally:
                child.communicate('stop\n')
                self.assertEqual(child.returncode, 0)

    def test_process_inspection_fails_closed(self):
        with patch.object(migration.shutil, 'which', return_value='/usr/sbin/lsof'):
            with patch.object(migration.subprocess, 'run') as run:
                run.return_value.stdout = b'123\n'
                run.return_value.stderr = b''
                run.return_value.returncode = 0
                with self.assertRaises(ValueError):
                    migration.stopped(Path('/fixture'))
                run.return_value.stdout = b''
                run.return_value.stderr = b'inspection failed'
                run.return_value.returncode = 1
                with self.assertRaises(ValueError):
                    migration.stopped(Path('/fixture'))


if __name__ == '__main__':
    unittest.main()
