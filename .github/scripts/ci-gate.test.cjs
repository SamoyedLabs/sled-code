const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { decide, readWorkspace } = require("./ci-changes.cjs");

const workflow = fs.readFileSync(path.join(__dirname, "../workflows/ci.yml"), "utf8");
const jobs = [...workflow.split("\njobs:\n")[1].matchAll(/^  ([a-z_]+):$/gm)]
  .map((match) => match[1])
  .filter((job) => job !== "check");
const check = workflow.split("  check:\n")[1];
const needs = check
  .match(/    needs:\s*\[([\s\S]*?)\]/)[1]
  .split(",")
  .map((job) => job.trim())
  .filter(Boolean);
const gateStep = check
  .split("      - name: Require every job to pass\n")[1]
  .split(/\n      (?:#|- name:)/)[0];
const script = gateStep.split("        run: |\n")[1].replace(/^          /gm, "");
const renamed = {
  build: ["build", "typecheck"],
  mobile_native_static_analysis: ["mobile_native"],
  test_web_boot: ["test_web"],
  test_mobile_compiler: ["test_mobile"],
};
function resultsFor(files) {
  const { outputs } = decide(files, readWorkspace(), false);
  const gates = Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [key, String(value)]),
  );
  return Object.fromEntries(
    jobs.map((job) => [
      job,
      {
        result:
          job === "changes" || (renamed[job] || [job]).some((gate) => gates[gate] !== "false")
            ? "success"
            : "skipped",
        ...(job === "changes" ? { outputs: gates } : {}),
      },
    ]),
  );
}
function passes(results) {
  const run = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
    encoding: "utf8",
    env: { ...process.env, RESULTS: JSON.stringify(results) },
  });
  assert.ifError(run.error);
  return run.status === 0;
}
test("Check depends on every CI job, including every split test group", () => {
  assert.deepEqual([...needs].sort(), [...jobs].sort());
  assert.match(check, /if: \$\{\{ always\(\) \}\}/);
});
test("the real Check gate accepts full, affected and documentation-only results", () => {
  for (const files of [
    null,
    ["README.md"],
    ["apps/mobile/src/example.tsx"],
    ["apps/web/src/example.tsx"],
  ]) {
    assert.equal(passes(resultsFor(files)), true, JSON.stringify(files));
  }
});
test("the real Check gate rejects failures, cancellation and missing required work", () => {
  for (const job of jobs) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const results = resultsFor(null);
      results.changes.outputs.docs = "true";
      results.docs.result = "success";
      results[job].result = result;
      assert.equal(passes(results), false, `${job}: ${result}`);
    }
  }
});
test("missing routing output cannot authorize a skipped compiler job", () => {
  const results = resultsFor(["README.md"]);
  delete results.changes.outputs.test_mobile;
  assert.equal(passes(results), false);
});
