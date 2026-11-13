import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('retry', Path(__file__).with_name('ci-runner-retry.py'))
retry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retry)

REPO = 'SamoyedLabs/sled-code'
RUN = dict(id=10, run_attempt=1, status='completed', conclusion='failure',
           path='.github/workflows/ci.yml', head_repository=dict(full_name=REPO))
HOST = dict(id=20, name='Remote Desktop Host Build', conclusion='cancelled',
            runner_name='', steps=[], check_run_url='https://api.github.com/repos/' + REPO + '/check-runs/20')
GATE = dict(id=30, name='Check', conclusion='failure', runner_name='runner',
            steps=[dict(name='Require every job to pass', conclusion='failure')])
ANNOTATIONS = [dict(annotation_level='failure', message='The job was not acquired by Runner of type hosted even after multiple attempts'),
               dict(annotation_level='notice', message='Due to capacity constraints, jobs targeting macOS arm64 runners may experience longer queue times.')]


class RetryTests(unittest.TestCase):
    def execute(self, run=None, jobs=None, annotations=None, event_attempt=1):
        run = copy.deepcopy(RUN if run is None else run)
        jobs = copy.deepcopy([HOST, GATE] if jobs is None else jobs)
        annotations = ANNOTATIONS if annotations is None else annotations
        api = Mock(return_value=run)
        pages = Mock(side_effect=[[{'jobs': jobs}], [annotations]])
        result = retry.retry_run(REPO, run['id'], event_attempt, api=api, pages=pages)
        posts = [call for call in api.call_args_list if call.args[1:] == ('POST',)]
        return result, posts, pages

    def test_runner_capacity_failure_retries_only_failed_jobs(self):
        result, posts, pages = self.execute()
        self.assertTrue(result)
        self.assertEqual(posts[0].args, (f'repos/{REPO}/actions/runs/10/rerun-failed-jobs', 'POST'))
        self.assertEqual(pages.call_args_list[1].args, (f'repos/{REPO}/check-runs/20/annotations?per_page=100',))

    def test_two_retries_then_stop_including_stale_events(self):
        for attempt, event_attempt, expected in [(1, 1, True), (2, 2, True), (3, 3, False), (2, 1, False)]:
            with self.subTest(attempt=attempt, event_attempt=event_attempt):
                result, posts, _ = self.execute({**RUN, 'run_attempt': attempt}, event_attempt=event_attempt)
                self.assertEqual(result, expected)
                self.assertEqual(bool(posts), expected)

    def test_build_failures_and_unknown_cancellations_stay_red(self):
        for jobs in [
            [GATE],
            [HOST, GATE, dict(HOST, id=40, name='Test', conclusion='failure', steps=[dict(conclusion='failure')])],
            [dict(HOST, runner_name='allocated'), GATE],
            [dict(HOST, steps=[dict(conclusion='failure')]), GATE],
        ]:
            with self.subTest(jobs=jobs):
                self.assertFalse(self.execute(jobs=jobs)[1])
        for annotations in [[], [ANNOTATIONS[1]], [dict(annotation_level='failure', message='Test failed')]]:
            with self.subTest(annotations=annotations):
                self.assertFalse(self.execute(annotations=annotations)[1])

    def test_cancelled_successful_running_and_untrusted_runs_are_ignored(self):
        for changes in [dict(conclusion='cancelled'), dict(conclusion='success'), dict(status='in_progress'),
                        dict(path='.github/workflows/release.yml'),
                        dict(head_repository=dict(full_name='someone/fork'))]:
            with self.subTest(changes=changes):
                result, posts, pages = self.execute({**RUN, **changes})
                self.assertFalse(result)
                self.assertFalse(posts)
                pages.assert_not_called()

    def test_unrelated_gate_failure_and_untrusted_annotation_url_do_not_retry(self):
        for jobs in [
            [HOST, dict(GATE, steps=[dict(name='Require transfer measurements', conclusion='failure')])],
            [dict(HOST, check_run_url='https://example.com/check-runs/20'), GATE],
        ]:
            with self.subTest(jobs=jobs):
                self.assertFalse(self.execute(jobs=jobs)[1])

    def test_race_with_manual_retry_does_not_start_another_attempt(self):
        api = Mock(side_effect=[RUN, {**RUN, 'status': 'queued', 'run_attempt': 2}])
        pages = Mock(side_effect=[[{'jobs': [HOST, GATE]}], [ANNOTATIONS]])
        self.assertFalse(retry.retry_run(REPO, 10, 1, api=api, pages=pages))
        self.assertEqual(api.call_count, 2)


if __name__ == '__main__':
    unittest.main()
