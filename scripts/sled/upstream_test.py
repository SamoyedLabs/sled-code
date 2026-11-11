import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("upstream", Path(__file__).with_name("upstream.py"))
upstream = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(upstream)
CONFIG = json.loads((Path(__file__).resolve().parents[2] / "config/sled-upstream.json").read_text())


class PolicyTests(unittest.TestCase):
    def test_blocked_sync_fails_after_recording_the_attention_issue(self):
        issue = {"number": 34, "title": upstream.BLOCKER_TITLE}
        with patch.object(upstream, "api", side_effect=[[issue], {}]) as api, \
             patch.object(upstream, "summary"):
            with self.assertRaisesRegex(RuntimeError, "Automatic updates are held"):
                upstream.blocker("SamoyedLabs/sled-code", "Upstream merge conflicts: App.tsx")
            self.assertEqual(api.call_args.args[1], "PATCH")
            self.assertIn("App.tsx", api.call_args.args[2]["body"])

    def test_candidate_and_cleanup_pushes_use_environment_credentials_without_embedding_them(self):
        checkout = Path("/isolated/checkout")
        for arguments in [
            ("origin", "a" * 40 + ":refs/heads/upstream/nightly"),
            ("--force-with-lease=refs/heads/upstream/nightly:" + "a" * 40,
             "origin", ":refs/heads/upstream/nightly"),
        ]:
            with self.subTest(arguments=arguments), \
                 patch.dict(upstream.os.environ, {"GH_TOKEN": "sentinel-secret-never-in-argv"}), \
                 patch.object(upstream, "git") as git:
                upstream.authenticated_push(*arguments, cwd=checkout)
                git.assert_called_once_with("-c", "credential.helper=", "-c",
                                            "credential.helper=!gh auth git-credential", "push",
                                            *arguments, cwd=checkout)
                self.assertNotIn("sentinel-secret-never-in-argv", repr(git.call_args))

    def test_native_edits_are_not_automatically_physical_testing(self):
        changes = [("M", "apps/mobile/modules/t3-remote-desktop/ios/T3NativeSession.swift")]
        self.assertEqual(upstream.classify(changes, CONFIG), [])

    def test_sensitive_changes_and_feature_deletion_are_held(self):
        for change in [
            ("M", ".github/workflows/ci.yml"),
            ("M", "apps/server/src/auth/session.ts"),
            ("A", "apps/server/src/MigrationV3.ts"),
            ("D", "apps/server/src/remoteDesktop/Service.ts"),
        ]:
            with self.subTest(change=change):
                self.assertTrue(upstream.classify([change], CONFIG))

    def test_latest_published_nightly_ignores_stable_preview_and_draft(self):
        releases = [
            {"tag_name": "v0.1.4-nightly.20261028.3824", "published_at": "2026-10-28"},
            {"tag_name": "v0.1.7-nightly.20261031.3991", "published_at": "2026-10-31"},
            {"tag_name": "v0.1.8-preview.20261101.4000", "published_at": "2026-11-01"},
            {"tag_name": "v0.1.8", "published_at": "2026-11-01"},
            {"tag_name": "v0.1.8-nightly.20261101.4001", "published_at": "2026-11-01", "draft": True},
        ]
        self.assertEqual(upstream.latest_release(releases)["tag_name"], "v0.1.7-nightly.20261031.3991")

    def test_untrusted_ref_or_duplicate_metadata_is_rejected(self):
        for value in ["main", "--upload-pack=evil", "a" * 39, "$(whoami)"]:
            with self.assertRaises(ValueError):
                upstream.require_sha(value)
        value = {"base": "a" * 40, "upstream": "b" * 40, "head": "c" * 40,
                 "tag": "v0.1.7-nightly.20261031.3991"}
        body = upstream.MARKER + json.dumps(value) + " -->"
        self.assertEqual(upstream.metadata(body), value)
        with self.assertRaises(RuntimeError):
            upstream.metadata(body + body)


class MergeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sled-upstream-test-")
        self.repo = Path(self.temporary.name)
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.write("shared.txt", "initial\n")
        self.initial = self.commit("Initial")

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *args):
        return upstream.git(*args, cwd=self.repo).stdout.strip()

    def write(self, name, text):
        (self.repo / name).write_text(text)

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def test_merge_preserves_sled_features_and_both_histories_without_moving_main(self):
        self.write("sled.txt", "remote desktop\n")
        base = self.commit("Sled integration")
        self.git("checkout", "-b", "upstream", self.initial)
        self.write("new-t3.txt", "new upstream feature\n")
        incoming = self.commit("Upstream feature")
        head = upstream.merge_candidate(base, incoming, self.repo)
        self.assertEqual(self.git("show", "-s", "--format=%P", head).split(), [base, incoming])
        self.assertEqual((self.repo / "sled.txt").read_text(), "remote desktop\n")
        self.assertEqual((self.repo / "new-t3.txt").read_text(), "new upstream feature\n")
        self.assertEqual(self.git("rev-parse", "main"), base)

    def test_release_merge_advances_source_pin_in_same_two_parent_commit(self):
        lock = {"t3code": {"commit": self.initial, "tag": "v0.1.4-nightly.20261028.3824", "checkout": "."},
                "sill": {"commit": "d" * 40, "checkout": "native/remote-desktop"}}
        self.write("sources.lock.json", json.dumps(lock))
        self.write("sled.txt", "remote desktop\n")
        base = self.commit("Sled integration")
        self.git("checkout", "-b", "upstream", self.initial)
        self.write("new-t3.txt", "upstream improvement\n")
        incoming = self.commit("Upstream feature")
        tag = "v0.1.7-nightly.20261031.3991"
        head = upstream.merge_candidate(base, incoming, self.repo, release_tag=tag)
        updated = json.loads(self.git("show", head + ":sources.lock.json"))
        self.assertEqual(updated["t3code"], {"commit": incoming, "tag": tag, "checkout": "."})
        self.assertEqual(updated["sill"], lock["sill"])
        self.assertEqual(self.git("show", "-s", "--format=%P", head).split(), [base, incoming])
        self.assertEqual(self.git("show", "-s", "--format=%an", head), "Sled Upstream")
        self.assertEqual((self.repo / "sled.txt").read_text(), "remote desktop\n")
        self.assertEqual((self.repo / "new-t3.txt").read_text(), "upstream improvement\n")
        self.assertEqual(self.git("rev-parse", "main"), base)
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_conflict_aborts_without_discarding_either_side(self):
        self.write("shared.txt", "sled\n")
        base = self.commit("Sled change")
        self.git("checkout", "-b", "upstream", self.initial)
        self.write("shared.txt", "upstream\n")
        incoming = self.commit("Upstream change")
        with self.assertRaisesRegex(RuntimeError, "shared.txt"):
            upstream.merge_candidate(base, incoming, self.repo)
        self.assertEqual(self.git("rev-parse", "HEAD"), base)
        self.assertEqual(self.git("rev-parse", "main"), base)
        self.assertEqual(self.git("show", incoming + ":shared.txt"), "upstream")
        self.assertEqual(self.git("status", "--porcelain"), "")


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.base, self.incoming, self.head = "a" * 40, "b" * 40, "c" * 40
        self.data = {"base": self.base, "upstream": self.incoming, "head": self.head,
                     "tag": "v0.1.7-nightly.20261031.3991"}
        self.pr = {"number": 1, "body": upstream.MARKER + json.dumps(self.data) + " -->", "labels": [],
                   "head": {"sha": self.head, "repo": {"full_name": "SamoyedLabs/sled-code"}}}

    def test_stale_base_cannot_merge_even_with_green_checks(self):
        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "api", return_value={"object": {"sha": "d" * 40}}) as api, \
             patch.object(upstream, "git") as git, patch.object(upstream, "summary"):
            upstream.finalize("SamoyedLabs/sled-code", CONFIG)
            self.assertEqual(api.call_count, 1)
            git.assert_not_called()

    def test_promotion_with_workflow_token_obeys_protection_freshness_and_merge_result(self):
        repo = "SamoyedLabs/sled-code"
        branch = {"protected": True, "commit": {"sha": self.base},
                  "protection": {"required_status_checks": {"contexts": ["Check"]}}}
        cases = [
            ("eligible", branch, {"merged": True}, True, None),
            ("unprotected", dict(branch, protected=False), None, False, "main must be protected"),
            ("missing check", dict(branch, protection={}), None, False, "main must be protected"),
            ("advanced base", dict(branch, commit={"sha": "d" * 40}), None, False, None),
            ("merge refused", branch, {"merged": False, "message": "Branch is behind"},
             True, "GitHub refused the checked merge"),
        ]
        for name, current_branch, merge_result, attempts_merge, error in cases:
            with self.subTest(name=name):
                def fake_api(endpoint, method="GET", payload=None):
                    if endpoint.endswith("/protection"):
                        raise RuntimeError("Resource not accessible by integration (HTTP 403)")
                    if "/git/ref/" in endpoint:
                        return {"object": {"sha": self.base}}
                    if "/actions/workflows/" in endpoint:
                        return {"workflow_runs": [{"id": 7, "head_sha": self.head, "event": "workflow_dispatch",
                                                   "run_number": 1, "status": "completed", "conclusion": "success"}]}
                    if "/actions/runs/7/jobs" in endpoint:
                        return {"jobs": [{"name": "Check", "conclusion": "success"}]}
                    if endpoint == f"repos/{repo}/branches/main":
                        return current_branch
                    if endpoint == f"repos/{repo}/pulls/1/merge" and method == "PUT":
                        return merge_result
                    raise AssertionError("Unexpected API call: " + endpoint)

                def fake_git(*args, **kwargs):
                    output = self.base + " " + self.incoming if args[0] == "show" else ""
                    if args[0] == "rev-parse":
                        output = self.incoming
                    return subprocess.CompletedProcess(args, 0, stdout=output, stderr="")

                with patch.object(upstream, "open_candidate", return_value=dict(self.pr, html_url="https://example.invalid/pr/1")), \
                     patch.object(upstream, "api", side_effect=fake_api) as api, \
                     patch.object(upstream, "git", side_effect=fake_git), \
                     patch.object(upstream, "changes_between", return_value=[]), \
                     patch.object(upstream, "authenticated_push") as push, patch.object(upstream, "summary"):
                    if error:
                        with self.assertRaisesRegex(RuntimeError, error):
                            upstream.finalize(repo, CONFIG)
                    else:
                        upstream.finalize(repo, CONFIG)
                    merges = [call for call in api.call_args_list if call.args[0].endswith("/merge")]
                    self.assertEqual(len(merges), int(attempts_merge))
                    if merges:
                        self.assertEqual(merges[0].args[2], {"sha": self.head, "merge_method": "merge"})
                    if name == "eligible":
                        push.assert_called_once_with("--force-with-lease=refs/heads/upstream/nightly:" + self.head,
                                                     "origin", ":refs/heads/upstream/nightly")
                    else:
                        push.assert_not_called()

    def test_modified_managed_head_requires_review(self):
        self.pr["head"]["sha"] = "d" * 40
        with patch.object(upstream, "open_candidate", return_value=self.pr), patch.object(upstream, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                upstream.finalize("SamoyedLabs/sled-code", CONFIG)
            api.assert_not_called()

    def test_held_candidate_is_not_reported_as_a_successful_sync(self):
        self.pr["labels"] = [{"name": "sled:hold"}]
        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "remains staged"):
                upstream.finalize("SamoyedLabs/sled-code", CONFIG)
            api.assert_not_called()

    def test_prepare_reports_a_hold_even_when_the_candidate_is_already_current(self):
        self.pr["labels"] = [{"name": "sled:hold"}]

        def fake_git(*args, **kwargs):
            output = ""
            if args[0] == "rev-parse":
                output = self.incoming if args[1].startswith("FETCH_HEAD") else self.base
            elif args[0] == "ls-remote":
                output = self.head + "\trefs/heads/upstream/nightly"
            return subprocess.CompletedProcess(args, 1 if args[0] == "merge-base" else 0,
                                               stdout=output, stderr="")

        with patch.object(upstream, "labels"), \
             patch.object(upstream, "pages", return_value=[{"tag_name": self.data["tag"]}]), \
             patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "git", side_effect=fake_git), \
             patch.object(upstream, "merge_candidate") as merge:
            with self.assertRaisesRegex(RuntimeError, "newer dependent updates remain held"):
                upstream.prepare("SamoyedLabs/sled-code", CONFIG)
            merge.assert_not_called()

    def test_included_managed_candidate_is_retired_with_an_exact_branch_lease(self):
        def fake_git(*args, **kwargs):
            output = ""
            if args[0] == "show":
                output = self.base + " " + self.incoming
            elif args[0] == "ls-remote":
                output = self.head + "\trefs/heads/upstream/nightly"
            return subprocess.CompletedProcess(args, 0, stdout=output, stderr="")

        issue = {"number": 34, "title": upstream.BLOCKER_TITLE}
        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "git", side_effect=fake_git), \
             patch.object(upstream, "api", side_effect=[{}, [issue], {}]) as api, \
             patch.object(upstream, "authenticated_push") as push, \
             patch.object(upstream, "summary"):
            upstream.clear_integrated_update("SamoyedLabs/sled-code", CONFIG, "d" * 40)
            push.assert_called_once_with("--force-with-lease=refs/heads/upstream/nightly:" + self.head,
                                         "origin", ":refs/heads/upstream/nightly")
            self.assertEqual(api.call_args_list[0].args[2], {"state": "closed"})
            self.assertEqual(api.call_args_list[-1].args[2],
                             {"state": "closed", "state_reason": "completed"})

    def test_modified_candidate_is_never_retired(self):
        self.pr["head"]["sha"] = "d" * 40
        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "blocker", side_effect=RuntimeError("extra edits")), \
             patch.object(upstream, "api") as api, \
             patch.object(upstream, "authenticated_push") as push:
            with self.assertRaisesRegex(RuntimeError, "extra edits"):
                upstream.clear_integrated_update("SamoyedLabs/sled-code", CONFIG, "e" * 40)
            api.assert_not_called()
            push.assert_not_called()

    def test_failed_branch_deletion_leaves_the_candidate_pr_open(self):
        def fake_git(*args, **kwargs):
            output = self.base + " " + self.incoming if args[0] == "show" else ""
            if args[0] == "ls-remote":
                output = self.head + "\trefs/heads/upstream/nightly"
            return subprocess.CompletedProcess(args, 0, stdout=output, stderr="")

        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "git", side_effect=fake_git), \
             patch.object(upstream, "authenticated_push", side_effect=RuntimeError("lease rejected")), \
             patch.object(upstream, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "lease rejected"):
                upstream.clear_integrated_update("SamoyedLabs/sled-code", CONFIG, "d" * 40)
            api.assert_not_called()

    def test_cleanup_can_resume_after_the_branch_was_deleted(self):
        def fake_git(*args, **kwargs):
            output = self.base + " " + self.incoming if args[0] == "show" else ""
            return subprocess.CompletedProcess(args, 0, stdout=output, stderr="")

        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "git", side_effect=fake_git), \
             patch.object(upstream, "api", side_effect=[{}, []]) as api, \
             patch.object(upstream, "authenticated_push") as push, \
             patch.object(upstream, "summary"):
            upstream.clear_integrated_update("SamoyedLabs/sled-code", CONFIG, "d" * 40)
            push.assert_not_called()
            self.assertEqual(api.call_args_list[0].args[2], {"state": "closed"})

    def test_candidate_history_missing_from_main_is_never_retired(self):
        def fake_git(*args, **kwargs):
            return subprocess.CompletedProcess(args, 1 if args[0] == "merge-base" else 0,
                                               stdout=self.base + " " + self.incoming if args[0] == "show" else "",
                                               stderr="")

        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "git", side_effect=fake_git), \
             patch.object(upstream, "blocker", side_effect=RuntimeError("missing history")), \
             patch.object(upstream, "api") as api, \
             patch.object(upstream, "authenticated_push") as push:
            with self.assertRaisesRegex(RuntimeError, "missing history"):
                upstream.clear_integrated_update("SamoyedLabs/sled-code", CONFIG, "d" * 40)
            api.assert_not_called()
            push.assert_not_called()

    def test_successful_check_on_other_commit_cannot_merge(self):
        def fake_api(endpoint, *args):
            if "/git/ref/" in endpoint:
                return {"object": {"sha": self.base}}
            if "/actions/workflows/" in endpoint:
                return {"workflow_runs": [{"head_sha": "d" * 40, "event": "workflow_dispatch", "conclusion": "success"}]}
            raise AssertionError("Unexpected API call: " + endpoint)

        def fake_git(*args, **kwargs):
            output = ""
            if args[0] == "show":
                output = self.base + " " + self.incoming
            elif args[0] == "rev-parse":
                output = self.incoming
            return subprocess.CompletedProcess(args, 0, stdout=output, stderr="")

        with patch.object(upstream, "open_candidate", return_value=self.pr), \
             patch.object(upstream, "api", side_effect=fake_api), \
             patch.object(upstream, "git", side_effect=fake_git), \
             patch.object(upstream, "changes_between", return_value=[]), patch.object(upstream, "summary"):
            upstream.finalize("SamoyedLabs/sled-code", CONFIG)


if __name__ == "__main__":
    unittest.main()
