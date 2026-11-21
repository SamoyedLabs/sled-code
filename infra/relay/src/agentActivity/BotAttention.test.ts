// @effect-diagnostics nodeBuiltinImport:off -- Authored Ed25519 credentials exercise the signed receiver without live accounts.
import * as NodeCrypto from "node:crypto";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { EnvironmentId, type OpenbotNotification } from "@t3tools/contracts";
import { signRelayJwt } from "@t3tools/shared/relayJwt";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as SqlClient from "effect/sql/SqlClient";
import * as Config from "../Config.ts";
import * as Replay from "../auth/DpopProofs.ts";
import * as Links from "../environments/EnvironmentLinks.ts";
import * as Devices from "./LiveActivities.ts";
import * as Apns from "./ApnsClient.ts";
import * as Fcm from "./FcmClient.ts";
import * as Attention from "./BotAttention.ts";
const keys = NodeCrypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
const preferences = {
  notificationsEnabled: true,
  liveActivitiesEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};
const notification: OpenbotNotification = {
  eventId: "durable-event",
  target: {
    kind: "bot",
    environmentId: EnvironmentId.make("env"),
    hostId: "host",
    agentId: "bot",
    taskId: "task",
  },
  phase: "needs_input",
  updatedAt: "2026-11-04T18:00:00Z",
};
it.effect(
  "uses exact linked recipients, verifies payload signatures and recovers delivery receipts without duplicate push",
  () => {
    let linked = true,
      send = 0,
      replayAllowed = true,
      enabled = true;
    const target: Devices.TargetRow = {
      user_id: "operator",
      device_id: "phone",
      platform: "ios",
      ios_major_version: 18,
      app_version: "1",
      bundle_id: "test.sled",
      aps_environment: "sandbox",
      push_token: "authored-device-token",
      push_to_start_token: null,
      preferences_json: stableStringify(preferences),
      activity_push_token: null,
      remote_start_queued_at: null,
      remote_started_at: null,
      ended_at: null,
      last_aggregate_json: null,
      last_live_activity_delivery_at: null,
    };
    const dependencies = Layer.mergeAll(
      NodeCryptoLayer.layer,
      Layer.mock(Config.RelayConfiguration)({
        clerkSecretKey: Redacted.make("authored-clerk"),
        clerkPublishableKey: "authored-clerk",
        clerkJwtAudience: "relay",
        apnsDeliveryJobSigningSecret: Redacted.make("authored-job"),
        cloudMintPrivateKey: Redacted.make(keys.privateKey),
        cloudMintPublicKey: keys.publicKey,
        managedEndpointBaseDomain: undefined,
        managedEndpointNamespace: undefined,
        relayIssuer: "https://relay.test",
        apns: {
          teamId: "team",
          keyId: "key",
          privateKey: Redacted.make("authored"),
          bundleId: "test.sled",
          environment: "sandbox",
        },
      }),
      Layer.mock(Replay.DpopProofReplay)({ consume: () => Effect.sync(() => replayAllowed) }),
      Layer.mock(Links.EnvironmentLinks)({
        listDeliveryUsersForEnvironment: () =>
          Effect.sync(() =>
            linked
              ? [
                  { userId: "operator", notificationsEnabled: true, liveActivitiesEnabled: true },
                  {
                    userId: "other-linked-owner",
                    notificationsEnabled: true,
                    liveActivitiesEnabled: true,
                  },
                ]
              : [],
          ),
      }),
      Layer.mock(Devices.LiveActivities)({
        listTargets: ({ userId }) =>
          Effect.sync(() => {
            expect(userId).toBe("operator");
            return [
              {
                ...target,
                preferences_json: stableStringify({
                  ...preferences,
                  notificationsEnabled: enabled,
                }),
              },
            ];
          }),
      }),
      Layer.mock(Apns.ApnsClient)({
        makeLiveActivityRequest: () => {
          throw new Error("unexpected live activity");
        },
        makePushNotificationRequest: () => {
          throw new Error("unexpected request projection");
        },
        sendPushNotificationRequest: (input) =>
          Effect.sync(() => {
            send++;
            expect(input.request.token).toBe("authored-device-token");
            expect(input.request.payload).toMatchObject({
              kind: "bot",
              deepLink: "/bots/env/host/bot/tasks/task",
            });
            return { ok: true, status: 200, apnsId: "acceptance" };
          }),
      }),
      Layer.mock(Fcm.FcmClient)({
        send: () => Effect.die("iOS target must not use Android transport"),
      }),
    );
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE relay_bot_attention_receipts(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,claimed_at TEXT NOT NULL,delivered_at TEXT)`;
      let serial = 0;
      const request = Effect.fn("test.botAttentionRequest")(function* (
        value = notification,
        recipientUserId = "operator",
      ) {
        const now = yield* DateTime.now;
        return {
          notification: value,
          recipientUserId,
          proof: yield* signRelayJwt({
            privateKey: keys.privateKey,
            typ: "t3-bot-attention+jwt",
            payload: {
              iss: "t3-env:env",
              aud: "https://relay.test",
              sub: "env",
              jti: `nonce-${++serial}`,
              iat: Math.floor(now.epochMilliseconds / 1000),
              exp: Math.floor(now.epochMilliseconds / 1000) + 300,
              notification: value,
              recipientUserId,
            },
          }),
        };
      });
      const publish = Effect.fn("test.publishBotAttention")(function* (
        value = notification,
        recipientUserId = "operator",
      ) {
        const service = yield* Attention.BotAttention;
        return yield* service.publish({
          environmentId: "env",
          environmentPublicKey: keys.publicKey,
          request: yield* request(value, recipientUserId),
        });
      });
      yield* Effect.gen(function* () {
        expect((yield* publish()).outcome).toBe("delivered");
        expect(send).toBe(1);
      }).pipe(Effect.provide(Attention.layer.pipe(Layer.provide(dependencies))));
      yield* Effect.gen(function* () {
        expect((yield* publish()).outcome).toBe("delivered");
        expect(send).toBe(1);
        expect((yield* publish(notification, "unlinked-user")).outcome).toBe("recipient-revoked");
        const service = yield* Attention.BotAttention;
        const original = yield* request();
        expect(
          (yield* service
            .publish({
              environmentId: "env",
              environmentPublicKey: keys.publicKey,
              request: { ...original, notification: { ...notification, eventId: "tampered" } },
            })
            .pipe(Effect.flip)).reason,
        ).toBe("authority");
        replayAllowed = false;
        expect(yield* publish().pipe(Effect.flip)).toMatchObject({ reason: "authority" });
        replayAllowed = true;
        linked = false;
        expect((yield* publish({ ...notification, eventId: "unlinked" })).outcome).toBe(
          "recipient-revoked",
        );
        linked = true;
        enabled = false;
        expect((yield* publish({ ...notification, eventId: "disabled-device" })).outcome).toBe(
          "no-device",
        );
        expect(send).toBe(1);
      }).pipe(Effect.provide(Layer.fresh(Attention.layer).pipe(Layer.provide(dependencies))));
    }).pipe(
      Effect.provide(
        Layer.merge(NodeSqliteClient.layer({ filename: ":memory:" }), NodeCryptoLayer.layer),
      ),
    );
  },
);
