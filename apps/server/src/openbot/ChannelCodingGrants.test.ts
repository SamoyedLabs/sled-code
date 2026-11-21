import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  IsoDateTime,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Integration from "./Integration.ts";
import * as Grants from "./ChannelCodingGrants.ts";
import * as Tools from "./SledTools.ts";
import { Caller, type Authority } from "./RemoteCoding.ts";
const caller = {
  kind: "session",
  sessionId: AuthSessionId.make("alice"),
  limits: { runtimeMode: "approval-required", interactionMode: "default" },
} satisfies Authority;
function fixture() {
  const state = { active: true, settings: true };
  const deps = Layer.mergeAll(
    Sqlite.layerMemory,
    SecureRandom.layerWebCrypto,
    ManagedPolicy.layerTest(),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      listSessions: () =>
        Effect.succeed(
          state.active
            ? [
                {
                  sessionId: caller.sessionId,
                  subject: "client",
                  scopes: [
                    AuthOrchestrationOperateScope,
                    ...(state.settings ? [AuthSettingsWriteScope] : []),
                  ],
                  permissions: [
                    AuthOrchestrationOperateScope,
                    ...(state.settings ? [AuthSettingsWriteScope] : []),
                  ],
                  method: "bearer-access-token",
                  client: { label: "Sled persistent bots", deviceType: "desktop" },
                  issuedAt: DateTime.makeUnsafe("2026-01-01"),
                  expiresAt: DateTime.makeUnsafe("2099-01-01"),
                  lastConnectedAt: null,
                  connected: false,
                  current: false,
                },
              ]
            : [],
        ),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({}),
    Layer.mock(Integration.Integration)({
      withChannelToHost: (host, action) =>
        action(
          {
            progressAvailable: Effect.succeed(false),
            progress: () => Effect.die("unused"),
            available: Effect.succeed(true),
            configure: () => Effect.succeed({ configured: true }),
            send: () => Effect.die("unused"),
            recover: () => Effect.die("unused"),
            verify: () => Effect.die("unused"),
            renew: () => Effect.die("unused"),
            receipt: () => Effect.die("unused"),
            submit: () => Effect.die("unused"),
          },
          { hostId: host, fingerprint: "pin" },
        ).pipe(
          Effect.mapError(
            (cause) => new Integration.IntegrationError({ message: "fixture", cause }),
          ),
        ),
    }),
    Layer.mock(Tools.SledTools)({
      assertConnector: () =>
        Effect.fail(new Tools.SledToolsError({ operation: "status", cause: "not connector" })),
    }),
  );
  return { state, layer: Grants.layer.pipe(Layer.provideMerge(deps)) };
}
it.effect(
  "requires actual settings authority and binds standing grants to exact host/bot/channel/requester until revocation",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const grants = yield* Grants.ChannelCodingGrants;
      const now = yield* DateTime.now;
      const input = {
        action: "create" as const,
        operationId: "approval-1",
        hostId: "host",
        agentId: "bot",
        channelId: "channel",
        requesterKind: "routine" as const,
        requesterId: "routine:morning",
        defaults: {
          projectId: ProjectId.make("project"),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
          runtimeMode: "approval-required" as const,
          interactionMode: "default" as const,
          workspaceStrategy: { type: "root" as const },
        },
        expiresAt: IsoDateTime.make(DateTime.formatIso(DateTime.add(now, { hours: 1 }))),
      };
      f.state.settings = false;
      expect((yield* grants.command(input).pipe(Effect.result))._tag).toBe("Failure");
      f.state.settings = true;
      const created = yield* grants.command(input);
      expect(created).toHaveLength(1);
      const scope = {
        hostId: "host",
        fingerprint: "pin",
        agentId: "bot",
        channelId: "channel",
        requesterKind: "routine" as const,
        requesterId: "routine:morning",
      };
      expect((yield* grants.resolve(scope)).authority).toEqual(caller);
      for (const field of ["hostId", "fingerprint", "agentId", "channelId", "requesterId"] as const)
        expect(
          (yield* grants.resolve({ ...scope, [field]: "other" }).pipe(Effect.result))._tag,
        ).toBe("Failure");
      yield* grants.command({ action: "revoke", hostId: "host", id: created[0]!.id });
      expect((yield* grants.resolve(scope).pipe(Effect.result))._tag).toBe("Failure");
    }).pipe(Effect.provideService(Caller, caller), Effect.provide(f.layer));
  },
);
