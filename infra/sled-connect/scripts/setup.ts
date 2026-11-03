// @effect-diagnostics nodeBuiltinImport:off - Standalone operator CLI, before the app runtime exists.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeReadlinePromises from "node:readline/promises";
import * as NodePath from "node:path";
import { secureOrigin } from "../src/config.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const generated = NodePath.resolve(root, ".generated");
NodeFS.mkdirSync(generated, { recursive: true, mode: 0o700 });
const terminal = NodeReadlinePromises.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const ask = async (name: string, label: string) =>
  process.env[name]?.trim() || (await terminal.question(label)).trim();

function wrangler(args: string[], input?: string): string {
  const child = NodeChildProcess.spawnSync("npx", ["--yes", "wrangler@4.156.0", ...args], {
    cwd: root,
    encoding: "utf8",
    ...(input
      ? { input, stdio: ["pipe", "pipe", "inherit"] }
      : { stdio: ["inherit", "pipe", "inherit"] }),
  });
  if (child.status !== 0) throw new Error(`Wrangler ${args[0]} failed.`);
  return child.stdout;
}

try {
  const account = await ask("CLOUDFLARE_ACCOUNT_ID", "Cloudflare account ID: ");
  const zone = await ask("CLOUDFLARE_ZONE_ID", "Cloudflare zone ID: ");
  const domain = await ask("SLED_TUNNEL_DOMAIN", "Domain on Cloudflare (example.com): ");
  const owner = await ask("SLED_OWNER_USER_ID", "Your Sled user ID (from Sled Connect settings): ");
  const issuer = process.env.SLED_CLERK_ISSUER ?? "https://clerk.samoyedlabs.com";
  const clientId = process.env.SLED_CLERK_CLI_CLIENT_ID ?? "u0RgFUiYWBBtqKEu";
  const relayUrl = await ask(
    "SLED_RELAY_URL",
    "Relay HTTPS address (leave blank to use workers.dev): ",
  );
  const name = process.env.SLED_WORKER_NAME ?? "sled-connect";
  const configPath = NodePath.resolve(generated, "wrangler.json");
  if (
    !/^[a-f0-9]{32}$/u.test(account) ||
    !/^[a-f0-9]{32}$/u.test(zone) ||
    !owner.startsWith("user_") ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(name) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(domain)
  )
    throw new Error("Check the account and zone IDs, domain, Worker name, and Sled user ID.");
  const deployment = {
    name,
    main: "../src/worker.ts",
    compatibility_date: "2026-11-01",
    workers_dev: true,
    account_id: account,
    triggers: { crons: ["*/5 * * * *"] },
    vars: {
      RELAY_URL: relayUrl ? secureOrigin(relayUrl) : "https://setup.invalid",
      CLERK_ISSUER: secureOrigin(issuer),
      CLERK_AUDIENCE: "sled-connect",
      CLERK_CLI_CLIENT_ID: clientId,
      OWNER_USER_ID: owner,
      TUNNEL_DOMAIN: domain,
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_ZONE_ID: zone,
      ALLOWED_ORIGINS:
        "https://auth.samoyedlabs.com,https://app.samoyedlabs.com,sled://app,sled-dev://app,sled-preview://app,t3code://app,t3code-dev://app",
    },
    d1_databases: [
      { binding: "DB", database_name: name, database_id: "", migrations_dir: "../migrations" },
    ],
  };
  const previous = NodeFS.existsSync(configPath)
    ? JSON.parse(NodeFS.readFileSync(configPath, "utf8"))
    : null;
  if (previous && (previous.name !== name || previous.account_id !== account))
    throw new Error("The existing deployment belongs to a different Worker or account.");
  if (!relayUrl && previous?.vars?.RELAY_URL) {
    deployment.vars.RELAY_URL = secureOrigin(previous.vars.RELAY_URL);
    if (previous.routes) Object.assign(deployment, { routes: previous.routes });
  }
  const result = previous ? "" : wrangler(["d1", "create", name]);
  const databaseId =
    previous?.d1_databases?.[0]?.database_id ??
    /"database_id"\s*:\s*"([a-f0-9-]+)"/u.exec(result)?.[1];
  if (!databaseId) throw new Error("Could not read the new D1 database ID.");
  deployment.d1_databases[0]!.database_id = databaseId;
  if (relayUrl && !new URL(relayUrl).hostname.endsWith(".workers.dev")) {
    Object.assign(deployment, {
      routes: [{ pattern: new URL(relayUrl).hostname, custom_domain: true }],
    });
  }
  NodeFS.writeFileSync(configPath, JSON.stringify(deployment, null, 2), { mode: 0o600 });
  wrangler(["d1", "migrations", "apply", name, "--remote", "--config", configPath]);
  const keyFile = NodePath.resolve(generated, `mint-keys-${name}.json`);
  let keys: { publicKey: string; privateKey: string };
  if (NodeFS.existsSync(keyFile)) {
    keys = JSON.parse(NodeFS.readFileSync(keyFile, "utf8"));
  } else {
    keys = NodeCrypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    NodeFS.writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600 });
  }
  const cloudflareToken = process.env.SLED_TUNNEL_API_TOKEN;
  if (cloudflareToken)
    wrangler(["secret", "put", "CLOUDFLARE_API_TOKEN", "--config", configPath], cloudflareToken);
  else {
    const child = NodeChildProcess.spawnSync(
      "npx",
      [
        "--yes",
        "wrangler@4.156.0",
        "secret",
        "put",
        "CLOUDFLARE_API_TOKEN",
        "--config",
        configPath,
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (child.status !== 0) throw new Error("Cloudflare token setup failed.");
  }
  wrangler(["secret", "put", "MINT_PRIVATE_KEY", "--config", configPath], keys.privateKey);
  wrangler(["secret", "put", "MINT_PUBLIC_KEY", "--config", configPath], keys.publicKey);
  let deployed = wrangler(["deploy", "--config", configPath]);
  if (deployment.vars.RELAY_URL === "https://setup.invalid") {
    const workerUrl = /https:\/\/[a-z0-9.-]+\.workers\.dev/u.exec(deployed)?.[0];
    if (!workerUrl)
      throw new Error("Could not discover the Worker address. Rerun with SLED_RELAY_URL set.");
    deployment.vars.RELAY_URL = workerUrl;
    NodeFS.writeFileSync(configPath, JSON.stringify(deployment, null, 2), { mode: 0o600 });
    deployed = wrangler(["deploy", "--config", configPath]);
  }
  process.stdout.write(deployed);
  process.stdout.write(
    `\nAdd ${deployment.vars.RELAY_URL} in Sled Connect settings.\nOn each host: t3 connect relay --url ${deployment.vars.RELAY_URL}\nThen run: t3 connect\n`,
  );
} finally {
  terminal.close();
}
