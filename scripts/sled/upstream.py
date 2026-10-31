#!/usr/bin/env python3
"""Prepare and promote tested T3 nightly merges without checking out candidate code in privileged jobs."""

import argparse
import fnmatch
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config/sled-upstream.json"
SHA = re.compile(r"^[0-9a-f]{40}$")
NIGHTLY = re.compile(r"^v?\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$")
MARKER = "<!-- sled-upstream "
BLOCKER_TITLE = "Upstream update needs attention"


def command(args, cwd=ROOT, check=True):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Command failed")
    return result


def git(*args, cwd=ROOT, check=True):
    return command(["git", *args], cwd, check)


def api(endpoint, method="GET", payload=None):
    args = ["gh", "api", endpoint, "--method", method]
    if payload is not None:
        args.extend(["--input", "-"])
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "GitHub API failed")
    return json.loads(result.stdout) if result.stdout.strip() else None


def pages(endpoint):
    result = command(["gh", "api", "--paginate", "--slurp", endpoint])
    return [item for page in json.loads(result.stdout) for item in page]


def require_sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError("Expected a full immutable Git commit SHA")
    return value


def latest_release(releases):
    eligible = [r for r in releases if not r.get("draft") and NIGHTLY.fullmatch(r.get("tag_name", ""))]
    if not eligible:
        raise RuntimeError("No published nightly release found")
    return max(eligible, key=lambda r: r.get("published_at") or "")


def classify(changes, config):
    reasons = []
    for status, path in changes:
        if any(fnmatch.fnmatchcase(path, pattern) for pattern in config["reviewPaths"]):
            reasons.append("Review sensitive change: " + path)
        if status == "D" and any(fnmatch.fnmatchcase(path, pattern) for pattern in config["protectedFeaturePaths"]):
            reasons.append("Sled feature file removed: " + path)
    return sorted(set(reasons))


def metadata(body):
    matches = re.findall(re.escape(MARKER) + r"(.*?) -->", body or "")
    if len(matches) != 1:
        raise RuntimeError("Candidate is missing unambiguous Sled update metadata")
    value = json.loads(matches[0])
    for key in ("base", "upstream", "head"):
        require_sha(value[key])
    if not NIGHTLY.fullmatch(value["tag"]):
        raise ValueError("Invalid upstream release tag")
    return value


def merge_candidate(base, upstream, cwd):
    """Only a detached disposable checkout is mutated; conflicts abort the attempt."""
    require_sha(base)
    require_sha(upstream)
    git("checkout", "--detach", base, cwd=cwd)
    result = git("-c", "user.name=Sled Upstream", "-c", "user.email=sled-upstream@users.noreply.github.com",
                 "merge", "--no-ff", "--no-edit", upstream, cwd=cwd, check=False)
    if result.returncode:
        paths = git("diff", "--name-only", "--diff-filter=U", cwd=cwd).stdout.strip().splitlines()
        git("merge", "--abort", cwd=cwd, check=False)
        raise RuntimeError("Upstream merge conflicts: " + ", ".join(paths))
    return require_sha(git("rev-parse", "HEAD", cwd=cwd).stdout.strip())


def changes_between(base, head, cwd=ROOT):
    fields = git("diff", "--no-renames", "--name-status", "-z", base, head, cwd=cwd).stdout.split("\0")
    return [(fields[i], fields[i + 1]) for i in range(0, len(fields) - 1, 2)]


def summary(message):
    print(message)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write(message + "\n")


def blocker(repo, message):
    issues = api(f"repos/{repo}/issues?state=open&labels=sled%3Aupstream&per_page=100")
    existing = next((i for i in issues if "pull_request" not in i and i["title"] == BLOCKER_TITLE), None)
    body = message + "\n\nAutomatic updates are held. The installed release is unaffected. No physical phone action is requested."
    if existing:
        api(f"repos/{repo}/issues/{existing['number']}", "PATCH", {"body": body})
    else:
        api(f"repos/{repo}/issues", "POST", {"title": BLOCKER_TITLE, "body": body, "labels": ["sled:upstream", "sled:hold"]})
    summary(body)


def labels(repo):
    for name, color in [("sled:upstream", "0366d6"), ("sled:hold", "d93f0b"),
                        ("sled:physical-required", "fbca04")]:
        try:
            api(f"repos/{repo}/labels", "POST", {"name": name, "color": color})
        except RuntimeError as error:
            if "already_exists" not in str(error) and "422" not in str(error):
                raise


def open_candidate(repo, config):
    owner = repo.split("/")[0]
    prs = api(f"repos/{repo}/pulls?state=open&base={config['baseBranch']}&head={owner}:{config['candidateBranch']}")
    if len(prs) > 1:
        raise RuntimeError("More than one candidate PR exists")
    return prs[0] if prs else None


def prepare(repo, config):
    labels(repo)
    base_branch, branch = config["baseBranch"], config["candidateBranch"]
    git("fetch", "origin", f"refs/heads/{base_branch}:refs/remotes/origin/{base_branch}")
    base = require_sha(git("rev-parse", f"origin/{base_branch}").stdout.strip())
    release = latest_release(pages(f"repos/{config['repository']}/releases?per_page=100"))
    tag = release["tag_name"]
    upstream_url = f"https://github.com/{config['repository']}.git"
    git("fetch", "--no-tags", upstream_url, f"refs/tags/{tag}")
    upstream = require_sha(git("rev-parse", "FETCH_HEAD^{commit}").stdout.strip())
    if git("merge-base", "--is-ancestor", upstream, base, check=False).returncode == 0:
        summary(f"Already contains {tag} ({upstream}). No update needed.")
        return
    existing = open_candidate(repo, config)
    old_head = None
    remote = git("ls-remote", "origin", f"refs/heads/{branch}").stdout.strip()
    if remote:
        old_head = require_sha(remote.split()[0])
        if not existing:
            blocker(repo, f"Branch `{branch}` exists without an open managed PR; preserving it for review.")
            return
        old = metadata(existing["body"])
        if old_head != old["head"]:
            blocker(repo, "Candidate has edits beyond the managed merge. Preserving those changes for review.")
            return
        if old["base"] == base and old["upstream"] == upstream:
            summary(f"Existing candidate #{existing['number']} already tracks {tag}; no duplicate work.")
            return
        held = {label["name"] for label in existing.get("labels", [])} & set(config["holdLabels"])
        if held:
            summary(f"Candidate #{existing['number']} is staged ({', '.join(sorted(held))}); newer dependent updates remain held.")
            return
    with tempfile.TemporaryDirectory(prefix="sled-upstream-") as temporary:
        checkout = Path(temporary) / "checkout"
        command(["git", "clone", "--shared", "--no-checkout", str(ROOT), str(checkout)])
        try:
            head = merge_candidate(base, upstream, checkout)
        except RuntimeError as error:
            blocker(repo, f"Cannot integrate `{tag}` ({upstream}) onto {base}:\n\n{error}")
            return
        reasons = classify(changes_between(base, head, checkout), config)
        data = {"base": base, "upstream": upstream, "head": head, "tag": tag}
        body = (f"Integrates [{tag}](https://github.com/{config['repository']}/releases/tag/{tag}) while retaining Sled changes.\n\n"
                f"Upstream: `{upstream}`\nBase: `{base}`\nCandidate: `{head}`\n\n"
                + ("Staged for review:\n" + "\n".join("- " + reason for reason in reasons) if reasons
                   else "Eligible for automatic merge after CI succeeds on this exact candidate and the base is still current.")
                + "\n\nNative edits alone do not require physical testing. Add `sled:physical-required` only for a specific unresolved hardware concern.\n\n"
                + MARKER + json.dumps(data, sort_keys=True) + " -->")
        push = ["push"]
        if old_head:
            push.append(f"--force-with-lease=refs/heads/{branch}:{old_head}")
        push.extend(["origin", f"{head}:refs/heads/{branch}"])
        # The disposable clone uses a local origin; push through the configured repository remote.
        git("remote", "set-url", "origin", git("remote", "get-url", "origin").stdout.strip(), cwd=checkout)
        git(*push, cwd=checkout)
    title = "chore(upstream): integrate T3 " + tag
    if existing:
        pr = api(f"repos/{repo}/pulls/{existing['number']}", "PATCH", {"title": title, "body": body})
    else:
        pr = api(f"repos/{repo}/pulls", "POST", {"title": title, "head": branch, "base": base_branch, "body": body})
    api(f"repos/{repo}/issues/{pr['number']}/labels", "POST",
        {"labels": ["sled:upstream"] + (["sled:hold"] if reasons else [])})
    # Explicit dispatch avoids relying on token-created PR event recursion behavior.
    api(f"repos/{repo}/actions/workflows/{config['ciWorkflow']}/dispatches", "POST",
        {"ref": branch, "inputs": {"candidate_sha": head, "base_sha": base}})
    summary(f"Prepared {pr['html_url']} at {head}; CI dispatched. " + ("Staged for review." if reasons else "Awaiting Check."))


def finalize(repo, config):
    pr = open_candidate(repo, config)
    if not pr:
        summary("No open upstream candidate.")
        return
    held = {label["name"] for label in pr.get("labels", [])} & set(config["holdLabels"])
    if held or not config["autoMerge"]:
        summary(f"Candidate #{pr['number']} remains staged: {', '.join(sorted(held)) or 'automatic merge disabled'}.")
        return
    data = metadata(pr["body"])
    if pr["head"]["sha"] != data["head"] or pr["head"]["repo"]["full_name"].lower() != repo.lower():
        raise RuntimeError("Candidate identity changed; refusing promotion")
    current = api(f"repos/{repo}/git/ref/heads/{config['baseBranch']}")["object"]["sha"]
    if current != data["base"]:
        summary("Main advanced; a new integration candidate and CI run are required.")
        return
    git("fetch", "origin", data["head"])
    parents = git("show", "-s", "--format=%P", data["head"]).stdout.strip().split()
    if parents != [data["base"], data["upstream"]]:
        raise RuntimeError("Candidate is not the expected two-parent upstream merge")
    git("fetch", "--no-tags", f"https://github.com/{config['repository']}.git", f"refs/tags/{data['tag']}")
    if git("rev-parse", "FETCH_HEAD^{commit}").stdout.strip() != data["upstream"]:
        raise RuntimeError("Upstream tag moved; refusing promotion")
    reasons = classify(changes_between(data["base"], data["head"]), config)
    if reasons:
        api(f"repos/{repo}/issues/{pr['number']}/labels", "POST", {"labels": ["sled:hold"]})
        summary("Candidate staged: " + "; ".join(reasons))
        return
    runs = api(f"repos/{repo}/actions/workflows/{config['ciWorkflow']}/runs?head_sha={data['head']}&per_page=100")["workflow_runs"]
    runs = [run for run in runs if run["head_sha"] == data["head"] and run["event"] in ("workflow_dispatch", "pull_request", "push")]
    if not runs:
        summary("No CI run exists for the exact candidate; waiting.")
        return
    run = max(runs, key=lambda value: (value["run_number"], value.get("run_attempt", 1)))
    jobs = api(f"repos/{repo}/actions/runs/{run['id']}/jobs?filter=latest&per_page=100")["jobs"]
    gate = [job for job in jobs if job["name"] == config["requiredJob"]]
    if run["status"] == "completed" and run["conclusion"] in ("failure", "timed_out", "action_required"):
        blocker(repo, f"Candidate #{pr['number']} failed CI: {run['html_url']}. Automated repair is not configured; the candidate remains staged for diagnosis.")
        return
    if run["conclusion"] != "success" or len(gate) != 1 or gate[0]["conclusion"] != "success":
        summary(f"Candidate waiting: CI {run['status']}/{run['conclusion']}; Check must succeed.")
        return
    protection = api(f"repos/{repo}/branches/{config['baseBranch']}/protection")
    checks = protection.get("required_status_checks") or {}
    if not checks.get("strict") or config["requiredJob"] not in checks.get("contexts", []):
        summary("Automatic merge held: main requires strict up-to-date branch protection with Check.")
        return
    result = api(f"repos/{repo}/pulls/{pr['number']}/merge", "PUT",
                 {"sha": data["head"], "merge_method": "merge"})
    if not result.get("merged"):
        raise RuntimeError("GitHub refused the checked merge: " + result.get("message", "unknown"))
    git("push", f"--force-with-lease=refs/heads/{config['candidateBranch']}:{data['head']}",
        "origin", f":refs/heads/{config['candidateBranch']}")
    summary(f"Merged {pr['html_url']} after exact-candidate CI success. No release was published.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "finalize", "inspect"])
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", "SamoyedLabs/sled-code"))
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text())
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        parser.error("Invalid repository")
    if args.action == "inspect":
        summary(json.dumps(config, indent=2))
    else:
        globals()[args.action](args.repository, config)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, KeyError) as error:
        summary("Upstream automation stopped: " + str(error))
        sys.exit(1)
