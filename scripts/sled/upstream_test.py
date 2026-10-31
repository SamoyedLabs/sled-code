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

    def test_modified_managed_head_requires_review(self):
        self.pr["head"]["sha"] = "d" * 40
        with patch.object(upstream, "open_candidate", return_value=self.pr), patch.object(upstream, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                upstream.finalize("SamoyedLabs/sled-code", CONFIG)
            api.assert_not_called()

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
