#!/usr/bin/env python3
"""Live phase progress and read-only GitHub timing reports; never print command arguments."""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def estimate(samples, elapsed):
    samples = sorted(samples)
    if len(samples) < 3:
        return f'ETA unavailable (n={len(samples)}; need 3 successful samples)'
    low, high = samples[0], samples[-1]
    if elapsed > high:
        return f'ETA unavailable (overrun; historical {low}–{high}s, n={len(samples)})'
    return (f'estimated remaining {max(0, math.ceil(low - elapsed))}–{math.ceil(high - elapsed)}s '
            f'(historical range, n={len(samples)}; not a deadline)')


def api(repository, path):
    result = subprocess.run(['gh', 'api', f'repos/{repository}/{path}'],
                            capture_output=True, text=True, timeout=5)
    if result.returncode:
        raise RuntimeError('GitHub timing API unavailable')
    return json.loads(result.stdout)


def jobs_for(repository, run_id, attempt):
    result = []
    for page in range(1, 11):
        jobs = api(repository, f'actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100&page={page}')['jobs']
        result.extend(jobs)
        if len(jobs) < 100:
            return result
    raise RuntimeError('Job pagination limit exceeded')


def add_history(history, jobs):
    for job in jobs:
        if job['conclusion'] != 'success':
            continue
        for step in job['steps']:
            if step['conclusion'] != 'success' or not step.get('completed_at') or not step.get('started_at'):
                continue
            duration = round(timestamp(step['completed_at']) - timestamp(step['started_at']))
            if duration >= 0:
                history.setdefault(job['name'], {}).setdefault(step['name'], []).append(duration)


def history_for(repository, workflow):
    runs = api(repository, f'actions/workflows/{workflow}/runs?branch=main&status=success&per_page=5')['workflow_runs']
    history = {}
    now = time.time()
    deadline = time.monotonic() + 10
    for run in runs:
        if time.monotonic() > deadline:
            break
        if now - timestamp(run['created_at']) <= 30 * 86400:
            jobs = jobs_for(repository, run['id'], run['run_attempt'])
            add_history(history, jobs)
            completed = [timestamp(j['completed_at']) for j in jobs if j.get('completed_at')]
            if completed:
                history.setdefault('__runs__', []).append(dict(
                    jobs=job_set(jobs), seconds=round(max(completed) - timestamp(run['run_started_at']))))
    return history


def job_set(jobs):
    return sorted(j['name'] for j in jobs if j.get('conclusion') != 'skipped' and j['name'] != 'Check')


def job_status(job, history, now):
    steps = job.get('steps', [])
    allocated = next((s.get('started_at') for s in steps if s.get('started_at')), None)
    if job.get('conclusion') == 'skipped':
        return f"{job['name']}: skipped (not required)"
    if not allocated:
        return f"{job['name']}: {job['status']}/{job.get('conclusion') or 'pending'}; no executed steps reported; ETA unavailable"
    elapsed = max(0, round(now - timestamp(allocated)))
    if job.get('completed_at'):
        elapsed = round(timestamp(job['completed_at']) - timestamp(allocated))
    active = next((s for s in steps if s['status'] == 'in_progress'), None)
    if active:
        phase_elapsed = max(0, now - timestamp(active['started_at']))
        samples = history.get(job['name'], {}).get(active['name'], [])
        return f"{job['name']}: {active['name']}; job elapsed={elapsed}s; phase elapsed={round(phase_elapsed)}s; {estimate(samples, phase_elapsed)}"
    return f"{job['name']}: {job['status']}/{job.get('conclusion') or 'pending'}; execution={elapsed}s"


def run_phase(args):
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        raise ValueError('A command is required')
    try:
        history = json.loads(os.environ.get('CI_TIMING_BASELINE', '{}'))
    except ValueError:
        history = {}
    job = os.environ.get('CI_TIMING_JOB', os.environ.get('GITHUB_JOB', 'local'))
    samples = history.get(job, {}).get(args.phase, [])
    started = time.monotonic()
    stopped = threading.Event()
    record_path = args.records or (str(Path(os.environ['RUNNER_TEMP']) / 'ci-timings.jsonl')
                                   if os.environ.get('RUNNER_TEMP') else None)

    def emit(event, exit_code=None):
        elapsed = round(time.monotonic() - started, 1)
        record = dict(event=event, phase=args.phase, job=job,
                      at=datetime.now(timezone.utc).isoformat(), elapsed_seconds=elapsed,
                      historical_seconds=samples)
        if exit_code is not None:
            record['exit_code'] = exit_code
        print(f"[progress] {args.phase}: {event}; elapsed={elapsed}s; "
              + (f'exit={exit_code}' if exit_code is not None else estimate(samples, elapsed)), flush=True)
        if event == 'finish' and os.environ.get('GITHUB_STEP_SUMMARY'):
            try:
                with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
                    summary.write(f'- **{args.phase}**: {elapsed}s; exit {exit_code}; history n={len(samples)}.\n')
            except OSError:
                print('[progress] Could not write timing summary', flush=True)
        if record_path:
            try:
                with open(record_path, 'a') as stream:
                    stream.write(json.dumps(record) + '\n')
            except OSError:
                print('[progress] Could not write timing record', flush=True)

    def heartbeat():
        while not stopped.wait(30):
            emit('running')

    emit('start')
    exit_code = 1
    child = None
    previous = {}
    def forward(signum, frame):
        if child is not None:
            child.send_signal(signum)
    for signum in (signal.SIGTERM, signal.SIGINT):
        previous[signum] = signal.signal(signum, forward)
    reporter = threading.Thread(target=heartbeat, daemon=True)
    try:
        child = subprocess.Popen(command)
        reporter.start()
        exit_code = child.wait()
        if exit_code < 0:
            exit_code = 128 - exit_code
    finally:
        stopped.set()
        if reporter.ident:
            reporter.join()
        for signum, handler in previous.items():
            signal.signal(signum, handler)
        emit('finish', exit_code)
    return exit_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    run = sub.add_parser('run')
    run.add_argument('--phase', required=True)
    run.add_argument('--records')
    run.add_argument('command', nargs=argparse.REMAINDER)
    history = sub.add_parser('history')
    history.add_argument('--workflow', required=True)
    history.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY'))
    status = sub.add_parser('status')
    status.add_argument('--repo', required=True)
    status.add_argument('--run', required=True)
    status.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.mode == 'run':
        return run_phase(args)
    if args.mode == 'history':
        try:
            baseline = history_for(args.repo, args.workflow)
        except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired):
            print('[progress] History unavailable; build continues without an ETA', flush=True)
            baseline = {}
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('timings=' + json.dumps(baseline, separators=(',', ':')) + '\n')
        print(f'[progress] Timing history loaded for {len([k for k in baseline if not k.startswith("__")])} jobs (up to 5 successful main runs, last 30 days)', flush=True)
        return 0
    run = api(args.repo, f'actions/runs/{args.run}')
    jobs = jobs_for(args.repo, args.run, run['run_attempt'])
    history = history_for(args.repo, run['workflow_id'])
    now = time.time()
    comparable = [r['seconds'] for r in history.get('__runs__', []) if r['jobs'] == job_set(jobs)]
    overall = estimate(comparable, now - timestamp(run['run_started_at']))
    if 'Mobile' in run['name'] or run['status'] == 'completed':
        overall = 'ETA unavailable (release mode unknown)' if run['status'] != 'completed' else 'finished'
    lines = [f"Run {run['html_url']} · attempt {run['run_attempt']} · {run['status']}/{run['conclusion'] or 'pending'}",
             f'Whole run: {overall}. Based on successful runs with the same enabled jobs; queue delays can exceed history.']
    lines += [job_status(job, history, now) for job in jobs]
    print('\n'.join(lines))
    if args.output:
        args.output.write_text(json.dumps(dict(run=run, jobs=jobs, history=history), indent=2) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
