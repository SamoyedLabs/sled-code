"""Retry CI only when GitHub could not allocate a hosted runner."""

import json
import os
from pathlib import Path
import subprocess


def github_api(endpoint, method='GET'):
    result = subprocess.run(['gh', 'api', endpoint, '--method', method],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


def github_pages(endpoint):
    result = subprocess.run(['gh', 'api', '--paginate', '--slurp', endpoint],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def summary(message):
    print(message)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(message + '\n')


def retry_run(repo, run_id, event_attempt, *, api=github_api, pages=github_pages):
    endpoint = f'repos/{repo}/actions/runs/{run_id}'
    run = api(endpoint)
    if (repo != 'SamoyedLabs/sled-code'
            or run.get('path') != '.github/workflows/ci.yml'
            or (run.get('head_repository') or {}).get('full_name') != repo
            or run['status'] != 'completed' or run['conclusion'] != 'failure'
            or run['run_attempt'] != event_attempt):
        summary('No retry: run is ineligible or this completion event is stale.')
        return False
    if run['run_attempt'] >= 3:
        summary(f'CI run {run_id}: two retries exhausted; leaving the failure visible.')
        return False

    jobs = [job for page in pages(endpoint + '/jobs?filter=latest&per_page=100') for job in page['jobs']]
    blocked = [job for job in jobs if job['conclusion'] not in ('success', 'skipped')]
    candidates = []
    for job in blocked:
        failures = [step.get('name') for step in job.get('steps') or [] if step.get('conclusion') == 'failure']
        if job['name'] == 'Check' and job['conclusion'] == 'failure' and failures == ['Require every job to pass']:
            continue
        candidates.append(job)
    if not candidates:
        summary('No retry: no runner allocation failure found.')
        return False
    for job in candidates:
        if (job['conclusion'] not in ('cancelled', 'failure', 'startup_failure')
                or job.get('runner_name') or job.get('steps')):
            summary('No retry: a job ran or has an unrelated failure.')
            return False
        check_prefix = f'https://api.github.com/repos/{repo}/check-runs/'
        check_url = job.get('check_run_url') or ''
        check_id = check_url.removeprefix(check_prefix)
        if not check_url.startswith(check_prefix) or not check_id.isdecimal():
            summary('No retry: runner allocation evidence is unavailable.')
            return False
        annotations = [item for page in pages(f'repos/{repo}/check-runs/{check_id}/annotations?per_page=100')
                       for item in page]
        if not any(item.get('annotation_level') == 'failure'
                   and item.get('message') == 'The job was not acquired by Runner of type hosted even after multiple attempts'
                   for item in annotations):
            summary('No retry: GitHub did not confirm a hosted runner allocation failure.')
            return False

    # Re-read after inspecting evidence so a manual retry makes this event stale.
    latest = api(endpoint)
    if latest['status'] != 'completed' or latest['run_attempt'] != event_attempt:
        summary('No retry: another attempt has already started.')
        return False
    api(endpoint + '/rerun-failed-jobs', 'POST')
    summary(f'CI run {run_id}: requested retry {event_attempt}/2 for runner allocation failures and dependent checks.')
    return True


if __name__ == '__main__':
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    run = event['workflow_run']
    retry_run(os.environ['GITHUB_REPOSITORY'], int(run['id']), int(run['run_attempt']))
