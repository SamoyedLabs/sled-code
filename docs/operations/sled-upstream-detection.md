# Sled upstream release detection

The `sled-release-detector` Cloudflare Worker checks T3 Code's public release Atom
feed once per minute. It runs independently of GitHub Actions schedules and the
developer's Mac. GitHub's existing scheduled workflow remains a backup.

The Worker sends new nightly tags to a private T3 scheduled-task webhook. That
task verifies the release using GitHub, compares Sled's main source pin, and
dispatches `sled-upstream.yml` if the release has not already been attempted.
It reports existing conflict holds instead of retrying the same release. The
Worker stores the last successful notification in KV, retries failed deliveries,
and uses the feed's ETag to avoid reprocessing unchanged releases. KV is eventually
consistent, so the receiving task also checks for an existing workflow attempt.

Detection continues while the Mac is asleep. Starting the GitHub update through
T3 requires the linked T3 environment to be available; webhook delivery does not
remove that dependency. Merge conflicts and sensitive changes still hold updates.

## Deployment

Use the existing Cloudflare account with Wrangler. The namespace ID is in
`config/sled-release-detector.jsonc`; a different account needs its own namespace.

```sh
wrangler deploy --config config/sled-release-detector.jsonc
wrangler secret put WEBHOOK_URL --config config/sled-release-detector.jsonc
```

Enter the release-detection task's private webhook URL at the secret prompt.
Never commit it. The Worker needs no GitHub token and exposes no HTTP dispatch
endpoint. `GET /health` returns its last successful notification; Cloudflare
Workers Logs record each cron invocation, including unchanged feeds and failures.

```sh
node --test .github/scripts/sled-release-detector.test.mjs
wrangler tail --config config/sled-release-detector.jsonc
```

To pause detection, remove its cron trigger and redeploy. To disable handling,
pause the T3 scheduled task named **Sled upstream release detected**.
