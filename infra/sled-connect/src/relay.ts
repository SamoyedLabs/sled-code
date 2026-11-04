import { workerUuid, workerIsoDate, workerFetch } from "./platform.ts";
import * as Schema from "effect/Schema";
import {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkRequest,
  RelayEnvironmentLinkChallengeRequest,
  RelayEnvironmentConnectRequest,
  RelayManagedEndpointRecoveryProofPayload,
  RelayManagedEndpointRecoveryRequest,
  RelayManagedEndpointRecoveryRegistrationRequest,
  RelayEnvironmentHealthResponse,
  RelayEnvironmentHealthResponseProofPayload,
  RelayEnvironmentMintResponse,
  RelayEnvironmentMintResponseProofPayload,
} from "@t3tools/contracts/relay";
import { RelayError, secureOrigin, type RelayBindings } from "./config.ts";
import { bearer, hash, RelaySecurity } from "./security.ts";
import { type EnvironmentRow, RelayStore } from "./store.ts";
import { endpoint, Tunnels, validateOrigin } from "./tunnels.ts";

const decodeRelayEnvironmentConnectRequest = Schema.decodeUnknownSync(
  RelayEnvironmentConnectRequest,
);
const decodeRelayEnvironmentHealthResponse = Schema.decodeUnknownSync(
  RelayEnvironmentHealthResponse,
);
const decodeRelayEnvironmentHealthResponseProofPayload = Schema.decodeUnknownSync(
  RelayEnvironmentHealthResponseProofPayload,
);
const decodeRelayEnvironmentLinkChallengeRequest = Schema.decodeUnknownSync(
  RelayEnvironmentLinkChallengeRequest,
);
const decodeRelayEnvironmentLinkProofPayload = Schema.decodeUnknownSync(
  RelayEnvironmentLinkProofPayload,
);
const decodeRelayEnvironmentLinkRequest = Schema.decodeUnknownSync(RelayEnvironmentLinkRequest);
const decodeRelayEnvironmentMintResponse = Schema.decodeUnknownSync(RelayEnvironmentMintResponse);
const decodeRelayEnvironmentMintResponseProofPayload = Schema.decodeUnknownSync(
  RelayEnvironmentMintResponseProofPayload,
);
const decodeRelayManagedEndpointRecoveryProofPayload = Schema.decodeUnknownSync(
  RelayManagedEndpointRecoveryProofPayload,
);
const decodeRelayManagedEndpointRecoveryRegistrationRequest = Schema.decodeUnknownSync(
  RelayManagedEndpointRecoveryRegistrationRequest,
);
const decodeRelayManagedEndpointRecoveryRequest = Schema.decodeUnknownSync(
  RelayManagedEndpointRecoveryRequest,
);

export class PersonalRelay {
  readonly store: RelayStore;
  readonly security: RelaySecurity;
  readonly tunnels: Tunnels;
  readonly issuer: string;

  readonly env: RelayBindings;
  constructor(env: RelayBindings) {
    this.env = env;
    this.store = new RelayStore(env.DB);
    this.security = new RelaySecurity(env, this.store);
    this.tunnels = new Tunnels(env, this.store);
    this.issuer = secureOrigin(env.RELAY_URL);
  }

  async list(userId: string) {
    const { results } = await this.store.db
      .prepare("SELECT * FROM environments WHERE user_id=? AND revoked=0 ORDER BY linked_at")
      .bind(userId)
      .all<EnvironmentRow>();
    return {
      environments: results.map((row) => ({
        environmentId: row.id,
        label: row.label,
        endpoint: endpoint(row),
        linkedAt: row.linked_at,
      })),
    };
  }

  async challenge(userId: string, input: unknown) {
    const request = decodeRelayEnvironmentLinkChallengeRequest(input);
    this.checkCapabilities(request);
    const claims = {
      ...this.security.claims(userId, 300),
      kind: "environment_link_challenge",
      ...request,
    };
    return {
      challenge: await this.security.sign("t3-link-challenge+jwt", claims),
      expiresAt: workerIsoDate(Number(claims.exp) * 1000),
    };
  }

  private checkCapabilities(request: { managedTunnelsEnabled: boolean }) {
    if (!request.managedTunnelsEnabled) throw new RelayError(400, "managed_tunnel_required");
  }

  async link(userId: string, input: unknown) {
    const request = decodeRelayEnvironmentLinkRequest(input);
    this.checkCapabilities(request);
    const candidate = decodeRelayEnvironmentLinkProofPayload(this.security.decode(request.proof));
    const claims = decodeRelayEnvironmentLinkProofPayload(
      await this.security.verify(
        request.proof,
        "t3-env-link+jwt",
        candidate.environmentPublicKey,
        `t3-env:${candidate.environmentId}`,
        this.issuer,
      ),
    );
    if (
      claims.sub !== claims.environmentId ||
      claims.descriptor.environmentId !== claims.environmentId ||
      !claims.scopes.includes("managed_tunnels")
    ) {
      throw new RelayError(401, "invalid_link_proof");
    }
    const challenge = await this.security.verify(
      claims.challenge,
      "t3-link-challenge+jwt",
      this.env.MINT_PUBLIC_KEY,
      this.issuer,
      this.issuer,
    );
    if (
      challenge.sub !== userId ||
      ["notificationsEnabled", "liveActivitiesEnabled", "managedTunnelsEnabled"].some(
        (key) => challenge[key] !== request[key as keyof typeof request],
      )
    ) {
      throw new RelayError(401, "invalid_link_challenge");
    }
    validateOrigin(claims.origin);
    await this.store.consumeNonce(`challenge:${challenge.jti}`, Number(challenge.exp));
    await this.store.consumeNonce(`link:${claims.jti}`, claims.exp);
    return this.store.withLease(claims.environmentId, async () => {
      const existing = await this.store.db
        .prepare("SELECT * FROM environments WHERE id=?")
        .bind(claims.environmentId)
        .first<EnvironmentRow>();
      if (
        existing &&
        (existing.user_id !== userId || existing.public_key !== claims.environmentPublicKey)
      ) {
        throw new RelayError(409, "environment_identity_conflict");
      }
      const identity = await this.tunnels.identity(claims.environmentId, userId);
      const linkedAt = workerIsoDate();
      await this.store.db
        .prepare(
          "INSERT INTO environments(id,user_id,public_key,label,hostname,tunnel_name,origin_json,linked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,origin_json=excluded.origin_json",
        )
        .bind(
          claims.environmentId,
          userId,
          claims.environmentPublicKey,
          claims.descriptor.label,
          identity.hostname,
          identity.tunnelName,
          JSON.stringify(claims.origin),
          linkedAt,
        )
        .run();
      const row = await this.store.db
        .prepare("SELECT * FROM environments WHERE id=?")
        .bind(claims.environmentId)
        .first<EnvironmentRow>();
      if (!row) throw new RelayError(500, "allocation_missing");
      const provisioned = await this.tunnels.provision(row, claims.origin);
      const credential = workerUuid() + workerUuid();
      await this.store.db
        .prepare("UPDATE environments SET credential_hash=?,revoked=0,linked_at=? WHERE id=?")
        .bind(await hash(credential), linkedAt, row.id)
        .run();
      return {
        ok: true,
        cloudUserId: userId,
        environmentId: row.id,
        endpoint: provisioned.endpoint,
        endpointRuntime: provisioned.runtime,
        relayIssuer: this.issuer,
        environmentCredential: credential,
        cloudMintPublicKey: this.env.MINT_PUBLIC_KEY,
      };
    });
  }

  async exchange(request: Request) {
    const form = await request.formData();
    if (
      form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:token-exchange" ||
      form.get("subject_token_type") !== "urn:ietf:params:oauth:token-type:jwt" ||
      form.get("requested_token_type") !== "urn:ietf:params:oauth:token-type:access_token" ||
      form.get("resource") !== this.issuer
    ) {
      throw new RelayError(400, "invalid_token_exchange");
    }
    const userId = await this.security.user(String(form.get("subject_token") ?? ""));
    const clientId = form.get("client_id");
    if (clientId !== "t3-web" && clientId !== "t3-mobile")
      throw new RelayError(400, "invalid_client");
    const scope = String(form.get("scope") ?? "")
      .split(" ")
      .filter(Boolean);
    if (
      !scope.length ||
      scope.some(
        (item) =>
          ![
            "environment:connect",
            "environment:status",
            ...(clientId === "t3-mobile" ? ["mobile:registration"] : []),
          ].includes(item),
      )
    ) {
      throw new RelayError(400, "invalid_scope");
    }
    const thumbprint = await this.security.proof(request);
    const claims = {
      ...this.security.claims(userId, 1800),
      client_id: clientId,
      scope: scope.join(" "),
      cnf: { jkt: thumbprint },
    };
    return {
      access_token: await this.security.sign("t3-relay-dpop-access+jwt", claims),
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      token_type: "DPoP",
      expires_in: 1800,
      scope: scope.join(" "),
    };
  }

  async authorizeConnection(request: Request, scope: string) {
    const token = bearer(request, "DPoP");
    const claims = await this.security.verify(
      token,
      "t3-relay-dpop-access+jwt",
      this.env.MINT_PUBLIC_KEY,
      this.issuer,
      this.issuer,
      1800,
    );
    const thumbprint = await this.security.proof(request, token);
    if (
      claims.sub !== this.env.OWNER_USER_ID ||
      !String(claims.scope).split(" ").includes(scope) ||
      typeof claims.cnf !== "object" ||
      claims.cnf === null ||
      !("jkt" in claims.cnf) ||
      claims.cnf.jkt !== thumbprint
    ) {
      throw new RelayError(401, "invalid_dpop_authorization");
    }
    return { userId: claims.sub, thumbprint };
  }

  async connect(request: Request, id: string, statusOnly: boolean) {
    const { userId, thumbprint } = await this.authorizeConnection(
      request,
      statusOnly ? "environment:status" : "environment:connect",
    );
    const input = statusOnly ? null : decodeRelayEnvironmentConnectRequest(await request.json());
    if (input && (input.clientProofKeyThumbprint ?? input.clientKeyThumbprint) !== thumbprint) {
      throw new RelayError(401, "invalid_connection_key");
    }
    const row = await this.store.environment(id, userId);
    const target = endpoint(row);
    if (!row.tunnel_id) {
      if (statusOnly)
        return {
          environmentId: id,
          endpoint: target,
          status: "offline",
          offlineReason: "tunnel_released",
          checkedAt: workerIsoDate(),
        };
      throw new RelayError(503, "environment_offline");
    }
    const nonce = workerUuid();
    const claims = {
      ...this.security.claims(userId, 120, `t3-env:${id}`),
      environmentId: id,
      nonce,
      scope: [statusOnly ? "environment:status" : "environment:connect"],
      ...(statusOnly
        ? {}
        : {
            clientProofKeyThumbprint: thumbprint,
            cnf: { jkt: thumbprint },
            ...(input?.deviceId ? { deviceId: input.deviceId } : {}),
          }),
    };
    const proof = await this.security.sign(
      statusOnly ? "t3-cloud-health+jwt" : "t3-cloud-mint+jwt",
      claims,
    );
    const response = await workerFetch(
      target.httpBaseUrl +
        (statusOnly ? "/api/t3-connect/health" : "/api/t3-connect/mint-credential"),
      {
        method: "POST",
        body: JSON.stringify({ proof }),
        headers: { "content-type": "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      if (statusOnly)
        return {
          environmentId: id,
          endpoint: target,
          status: "offline",
          checkedAt: workerIsoDate(),
        };
      throw new RelayError(503, "environment_unreachable");
    }
    const data: unknown = await response.json();
    if (statusOnly) {
      const decoded = decodeRelayEnvironmentHealthResponse(data);
      const signed = decodeRelayEnvironmentHealthResponseProofPayload(
        await this.security.verify(
          decoded.proof,
          "t3-env-health+jwt",
          row.public_key,
          `t3-env:${id}`,
          this.issuer,
        ),
      );
      if (
        signed.environmentId !== id ||
        signed.sub !== id ||
        signed.requestNonce !== nonce ||
        signed.checkedAt !== decoded.checkedAt ||
        JSON.stringify(signed.descriptor) !== JSON.stringify(decoded.descriptor)
      )
        throw new RelayError(502, "invalid_environment_response");
      return {
        environmentId: id,
        endpoint: target,
        status: "online",
        checkedAt: decoded.checkedAt,
        descriptor: decoded.descriptor,
      };
    }
    const decoded = decodeRelayEnvironmentMintResponse(data);
    const signed = decodeRelayEnvironmentMintResponseProofPayload(
      await this.security.verify(
        decoded.proof,
        "t3-env-mint+jwt",
        row.public_key,
        `t3-env:${id}`,
        this.issuer,
      ),
    );
    if (
      signed.environmentId !== id ||
      signed.sub !== id ||
      signed.requestNonce !== nonce ||
      signed.clientProofKeyThumbprint !== thumbprint ||
      signed.credential !== decoded.credential
    ) {
      throw new RelayError(502, "invalid_environment_response");
    }
    return {
      environmentId: id,
      endpoint: target,
      credential: decoded.credential,
      expiresAt: decoded.expiresAt,
    };
  }

  async recover(request: Request, id: string, register: boolean) {
    await this.environmentAuthorization(request, id);
    const body: unknown = await request.json();
    const input = register
      ? decodeRelayManagedEndpointRecoveryRegistrationRequest(body)
      : decodeRelayManagedEndpointRecoveryRequest(body);
    const row = await this.store.environment(id, input.cloudUserId);
    const signed = decodeRelayManagedEndpointRecoveryProofPayload(
      await this.security.verify(
        input.proof,
        "t3-env-managed-tunnel-recovery+jwt",
        row.public_key,
        `t3-env:${id}`,
        this.issuer,
      ),
    );
    if (
      signed.environmentId !== id ||
      signed.sub !== id ||
      signed.cloudUserId !== row.user_id ||
      signed.action !== (register ? "register" : "recover") ||
      JSON.stringify(signed.origin) !== JSON.stringify(input.origin)
    ) {
      throw new RelayError(401, "invalid_recovery_proof");
    }
    validateOrigin(input.origin);
    await this.store.consumeNonce(`recovery:${signed.jti}`, signed.exp);
    return this.store.withLease(id, async () => {
      const current = await this.store.environment(id, row.user_id);
      if (register) {
        if (
          !("tunnelId" in input) ||
          !("tunnelId" in signed) ||
          input.tunnelId !== signed.tunnelId ||
          current.tunnel_id !== input.tunnelId
        )
          return { status: "recovery_required" };
        const provisioned = await this.tunnels.provision(current, input.origin);
        return {
          status: provisioned.runtime.tunnelId === input.tunnelId ? "ready" : "recovery_required",
        };
      }
      const provisioned = await this.tunnels.provision(current, input.origin);
      return { endpoint: provisioned.endpoint, endpointRuntime: provisioned.runtime };
    });
  }

  async environmentAuthorization(request: Request, id: string) {
    const row = await this.store.environment(id, this.env.OWNER_USER_ID);
    if (!row.credential_hash || (await hash(bearer(request))) !== row.credential_hash)
      throw new RelayError(401, "invalid_environment_credential");
    return row;
  }

  async remove(userId: string, id: string, releaseOnly: boolean) {
    return this.store.withLease(id, async () => {
      // Keep revoked allocations available for retrying failed external teardown.
      const row = await this.store.db
        .prepare("SELECT * FROM environments WHERE id=? AND user_id=?")
        .bind(id, userId)
        .first<EnvironmentRow>();
      if (!row) throw new RelayError(403, "environment_link_not_found");
      if (!releaseOnly) {
        await this.store.db
          .prepare("UPDATE environments SET revoked=1,credential_hash=NULL WHERE id=?")
          .bind(id)
          .run();
      }
      await this.tunnels.release(row, !releaseOnly);
      return { ok: true };
    });
  }
}
