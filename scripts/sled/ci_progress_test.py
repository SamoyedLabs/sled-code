"""Timing estimates must not turn missing, stale, or failed observations into promises."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ci_progress', Path(__file__).with_name('ci_progress.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProgressTests(unittest.TestCase):
    def test_estimates_require_history_and_report_overruns(self):
        self.assertIn('unavailable', m.estimate([100, 110], 20))
        self.assertIn('80–100s', m.estimate([100, 110, 120], 20))
        self.assertIn('n=3', m.estimate([100, 110, 120], 20))
        self.assertIn('overrun', m.estimate([100, 110, 120], 121))

    def test_history_excludes_failures_skips_and_unallocated_jobs(self):
        step = dict(name='Test', conclusion='success', started_at='2026-11-04T00:00:00Z',
                    completed_at='2026-11-04T00:01:00Z')
        job = dict(name='Test Server 1', conclusion='success', labels=['ubuntu-24.04'], steps=[step])
        history = {}
        m.add_history(history, [job, {**job, 'conclusion': 'failure'},
                                {**job, 'steps': [{**step, 'conclusion': 'skipped'}]}])
        self.assertEqual(history['Test Server 1']['Test'], [60])
        audit = m.accuracy([job], {'Test Server 1': {'Test': [40, 50, 55]}})
        self.assertEqual(audit, dict(samples=1, within_range=0, median_absolute_error=10))
        tiny = {**step, 'completed_at': '2026-11-04T00:00:01Z'}
        self.assertEqual(m.accuracy([{**job, 'steps': [tiny]}],
                                   {'Test Server 1': {'Test': [0, 1, 2]}})['samples'], 0)
        self.assertEqual(m.job_set([job, {**job, 'name': 'Unused', 'conclusion': 'skipped'},
                                   {**job, 'name': 'Check'}]), ['Test Server 1'])

    def test_wrapper_preserves_failure_and_records_no_command_or_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'timings.jsonl'
            result = subprocess.run([sys.executable, str(Path(m.__file__)), 'run', '--phase', 'fixture',
                                     '--records', str(target), '--', sys.executable, '-c',
                                     'import sys; sys.exit(7)'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 7)
            records = [json.loads(line) for line in target.read_text().splitlines()]
            self.assertEqual([r['event'] for r in records], ['start', 'finish'])
            self.assertEqual(records[-1]['exit_code'], 7)
            self.assertNotIn('sys.exit', target.read_text())
            self.assertIn('ETA unavailable', result.stdout)

    def test_release_history_uses_build_artifacts_and_excludes_future_runs(self):
        run = dict(id=10, run_attempt=2, created_at='2026-11-03T00:00:00Z',
                   run_started_at='2026-11-03T00:00:00Z', conclusion='success')
        step = dict(name='Build desktop', conclusion='success',
                    started_at='2026-11-03T00:00:00Z', completed_at='2026-11-03T00:01:00Z')
        job = dict(name='build', conclusion='success', completed_at=step['completed_at'], steps=[step])
        def api(repository, path):
            if path.startswith('actions/artifacts?'):
                return {'artifacts': [dict(workflow_run=dict(id=10, head_branch='main'))]}
            if path == 'actions/runs/10':
                return run
            if path == 'actions/runs/10/attempts/2/jobs?per_page=100&page=1':
                return {'jobs': [job]}
            self.fail('Unexpected request: ' + path)
        with patch.object(m, 'api', side_effect=api), patch.object(
                m.time, 'time', return_value=m.timestamp('2026-11-04T00:00:00Z')):
            history = m.history_for('owner/repo', 'sled-desktop-release.yml')
            self.assertEqual(history['build']['Build desktop'], [60])
            self.assertEqual(m.history_for('owner/repo', 'sled-desktop-release.yml',
                                          before=m.timestamp(run['created_at'])), {})

    def test_history_failure_does_not_block_builds(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            with patch.dict(m.os.environ, {'GITHUB_OUTPUT': str(output)}), patch.object(
                    m, 'history_for', side_effect=RuntimeError('unavailable')), patch.object(
                    sys, 'argv', ['ci_progress.py', 'history', '--workflow', 'ci.yml', '--repo', 'owner/repo']):
                self.assertEqual(m.main(), 0)
            self.assertEqual(output.read_text(), 'timings={}\n')

    def test_cancelled_before_allocation_has_no_execution_duration(self):
        row = m.job_status(dict(name='Native', status='completed', conclusion='cancelled',
                               started_at='2026-11-04T00:00:00Z', steps=[]), {}, 100)
        self.assertIn('no executed steps reported', row)


if __name__ == '__main__':
    unittest.main()
