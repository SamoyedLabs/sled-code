# Personal Sled Connect relay

Deploy one relay into your Cloudflare account. Sign in with Sled, then use your own
Cloudflare tunnels and D1 database. No Clerk secret key, PlanetScale subscription,
or T3 Chat account is required. Background push and remote Live Activity updates
are disabled in this version.

## Deploy

Use a domain whose DNS is managed by your Cloudflare account. Use the domain
itself, such as `example.com`, as the tunnel domain: machine addresses are
`sled-<id>.example.com`, covered by Cloudflare's normal wildcard certificate.
A nested tunnel domain requires a certificate covering its machine hostnames.

1. Install the repository dependencies with `vp i` and authenticate Wrangler with
   `npx wrangler login`.
2. Sign into Sled. Copy **Your Sled user ID** from the Sled Connect account page.
3. Create a Cloudflare token with **Account → Cloudflare Tunnel → Edit** for your
   account and **Zone → DNS → Edit** for your domain. Keep it private.
4. Run `vp run --filter @samoyedlabs/sled-connect setup`. Supply your account and
   zone IDs, domain, and Sled user ID. Leave the relay address blank to use
   `workers.dev`, or supply a custom domain in your Cloudflare account. Shared Sled
   authentication is already configured. The token prompt stores the token as a
   Worker secret; it is never sent to Sled.
5. Save the relay address in Sled Connect settings on each client. On a host, run
   `t3 connect relay --url https://your-relay.example.com`, then `t3 connect`.

The setup creates a D1 database and local `.generated/wrangler.json`. Keep the
generated signing keys safe; replacing them requires re-enrolling the hosts.
For updates, run `npx wrangler deploy --config .generated/wrangler.json` in this
directory. Rerunning setup reuses the existing database and signing keys.

## Behavior

Only `OWNER_USER_ID` can enroll or connect machines. A valid Sled login belonging
to another user grants no access. The relay verifies Clerk JWTs using public
keys; opaque OAuth tokens are unsupported. Sled's CLI OAuth application must issue
JWT access tokens. The relay and the host retain separate signing keys and
DPoP-bound connection credentials.

Normal terminal, agent, and device traffic goes through the machine's tunnel.
The relay coordinates credentials, DNS, tunnel provisioning, and recovery. It
forwards automation webhooks and can hold them while a host is offline if the
host enables that preference. The personal inbox retains at most 20 requests per
environment, 10 MiB total, for 24 hours. A five-minute job retries held requests.
An offline host can also request delivery immediately when it returns.

Free-tier usage limits apply to the owner's Cloudflare account, shared with that
account's other applications. Domains and native app distribution are separate.
