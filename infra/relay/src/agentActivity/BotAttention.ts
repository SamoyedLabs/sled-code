import {
  RelayBotAttentionProof,
  RelayAgentAwarenessPreferences,
  type RelayBotAttentionRequest,
  type RelayBotAttentionResponse,
} from "@t3tools/contracts/relay";
import { botNotificationDeepLink } from "@t3tools/shared/agentAwareness";
import { normalizeRelayIssuer, verifyRelayJwt } from "@t3tools/shared/relayJwt";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Config from "../Config.ts";
import * as SqlClient from "effect/sql/SqlClient";
import * as DpopProofs from "../auth/DpopProofs.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LiveActivities from "./LiveActivities.ts";
import * as ApnsClient from "./ApnsClient.ts";
import * as FcmClient from "./FcmClient.ts";

export class BotAttentionError extends Schema.TaggedError<BotAttentionError>()(
  "BotAttentionError",
  {
    reason: Schema.Literals(["authority", "storage", "delivery"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
export class BotAttention extends Context.Service<
  BotAttention,
  {
    readonly publish: (input: {
      readonly environmentId: string;
      readonly environmentPublicKey: string;
      readonly request: RelayBotAttentionRequest;
    }) => Effect.Effect<RelayBotAttentionResponse, BotAttentionError>;
  }
>()("t3code-relay/agentActivity/BotAttention") {}
const isBotAttentionError = Schema.is(BotAttentionError);
const decodePreferences = Schema.decodeOption(
  Schema.fromJsonString(RelayAgentAwarenessPreferences),
);
const make = Effect.gen(function* () {
  const config = yield* Config.RelayConfiguration;
  const sql = yield* SqlClient.SqlClient;
  const replay = yield* DpopProofs.DpopProofReplay;
  const links = yield* EnvironmentLinks.EnvironmentLinks;
  const devices = yield* LiveActivities.LiveActivities;
  const apns = yield* ApnsClient.ApnsClient;
  const fcm = yield* FcmClient.FcmClient;
  const digest = yield* Digest.Digest;
  return BotAttention.of({
    publish: Effect.fn("BotAttention.publish")(
      function* (input) {
        const now = yield* DateTime.now;
        const proof = yield* verifyRelayJwt({
          publicKey: input.environmentPublicKey,
          token: input.request.proof,
          typ: "t3-bot-attention+jwt",
          issuer: `t3-env:${input.environmentId}`,
          audience: normalizeRelayIssuer(config.relayIssuer),
          nowEpochSeconds: Math.floor(now.epochMilliseconds / 1000),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(RelayBotAttentionProof)),
          Effect.mapError((cause) => new BotAttentionError({ reason: "authority", cause })),
        );
        if (
          proof.sub !== input.environmentId ||
          proof.notification.target.environmentId !== input.environmentId ||
          proof.recipientUserId !== input.request.recipientUserId ||
          stableStringify(proof.notification) !== stableStringify(input.request.notification) ||
          proof.exp - proof.iat > 300 ||
          proof.iat > Math.floor(now.epochMilliseconds / 1000) + 30
        )
          return yield* new BotAttentionError({ reason: "authority" });
        const thumbprint = Hex.encode(
          yield* digest.digest(
            Digest.sha256,
            new TextEncoder().encode(
              stableStringify([input.environmentId, input.environmentPublicKey]),
            ),
          ),
        );
        if (
          !(yield* replay.consume({
            thumbprint: `bot-attention:${thumbprint}`,
            jti: proof.jti,
            iat: proof.iat,
            expiresAt: DateTime.makeUnsafe(proof.exp * 1000),
          }))
        )
          return yield* new BotAttentionError({ reason: "authority" });
        const users = yield* links.listDeliveryUsersForEnvironment({
          environmentId: input.environmentId,
          environmentPublicKey: input.environmentPublicKey,
        });
        if (
          !users.some((user) => user.userId === proof.recipientUserId && user.notificationsEnabled)
        )
          return { outcome: "recipient-revoked" as const };
        const targets = yield* devices.listTargets({ userId: proof.recipientUserId });
        let delivered = 0;
        let configured = false;
        let eligibleDeviceSeen = false;
        let pending = false;
        const deepLink = botNotificationDeepLink(proof.notification.target);
        if (deepLink === null) return yield* new BotAttentionError({ reason: "authority" });
        const title =
          proof.notification.phase === "needs_approval"
            ? "Bot needs your approval"
            : proof.notification.phase === "needs_input"
              ? "Bot needs your input"
              : proof.notification.phase === "completed"
                ? "Bot task completed"
                : proof.notification.phase === "failed"
                  ? "Bot task failed"
                  : "Bot task update";
        for (const target of targets) {
          const preferences = decodePreferences(target.preferences_json);
          if (
            !target.push_token ||
            Option.isNone(preferences) ||
            !preferences.value.notificationsEnabled
          )
            continue;
          const preference =
            proof.notification.phase === "needs_approval"
              ? preferences.value.notifyOnApproval
              : proof.notification.phase === "needs_input" || proof.notification.phase === "stale"
                ? preferences.value.notifyOnInput
                : proof.notification.phase === "failed"
                  ? preferences.value.notifyOnFailure
                  : preferences.value.notifyOnCompletion;
          if (!preference) continue;
          eligibleDeviceSeen = true;
          if (
            (target.platform === "ios" && !config.apns) ||
            (target.platform === "android" && !config.fcmServiceAccount)
          )
            continue;
          configured = true;
          const id = Hex.encode(
            yield* digest.digest(
              Digest.sha256,
              new TextEncoder().encode(
                stableStringify([
                  input.environmentId,
                  proof.notification.eventId,
                  proof.recipientUserId,
                  target.device_id,
                ]),
              ),
            ),
          );
          const claimed =
            yield* sql`INSERT INTO relay_bot_attention_receipts(id,payload_json,claimed_at) VALUES(${id},${stableStringify(proof.notification)},${DateTime.formatIso(now)}) ON CONFLICT(id) DO UPDATE SET claimed_at=excluded.claimed_at WHERE relay_bot_attention_receipts.delivered_at IS NULL AND relay_bot_attention_receipts.payload_json=excluded.payload_json AND relay_bot_attention_receipts.claimed_at < ${DateTime.formatIso(DateTime.subtract(now, { minutes: 10 }))} RETURNING id`;
          if (claimed.length === 0) {
            const receipt = yield* sql<{
              readonly delivered_at: string | null;
              readonly payload_json: string;
            }>`SELECT delivered_at,payload_json FROM relay_bot_attention_receipts WHERE id=${id}`;
            if (receipt[0]?.payload_json !== stableStringify(proof.notification))
              return yield* new BotAttentionError({ reason: "authority" });
            if (receipt[0]?.delivered_at) delivered++;
            else pending = true;
            continue;
          }
          let accepted = false;
          if (target.platform === "ios" && config.apns) {
            const response = yield* apns.sendPushNotificationRequest({
              credentials: {
                ...config.apns,
                ...(target.bundle_id ? { bundleId: target.bundle_id } : {}),
                ...(target.aps_environment ? { environment: target.aps_environment } : {}),
              },
              issuedAtUnixSeconds: Math.floor(now.epochMilliseconds / 1000),
              request: {
                token: target.push_token,
                priority: "10",
                payload: {
                  aps: {
                    alert: { title, body: "Open Sled to review the task." },
                    sound: "default",
                    "thread-id": `bot:${proof.notification.target.agentId}`,
                  },
                  ...proof.notification.target,
                  deepLink,
                  eventId: proof.notification.eventId,
                },
              },
            });
            accepted = response.ok;
            if (response.status === 410 || response.reason === "BadDeviceToken")
              yield* devices.invalidateDeliveryToken({
                userId: target.user_id,
                deviceId: target.device_id,
                kind: "push_notification",
                invalidatedAt: DateTime.formatIso(now),
              });
          } else if (target.platform === "android") {
            const response = yield* fcm.send({
              token: target.push_token,
              packageName: target.bundle_id,
              alert: true,
              data: {
                t3_kind: "bot_attention",
                device_id: target.device_id,
                user_id: target.user_id,
                updated_at: String(now.epochMilliseconds),
                alert_id: id,
                alert_group: `bot:${proof.notification.target.agentId}`,
                alert_title: title,
                alert_body: "Open Sled to review the task.",
                alert_path: deepLink,
              },
            });
            accepted = !response.unregistered;
            if (response.unregistered)
              yield* devices.invalidateDeliveryToken({
                userId: target.user_id,
                deviceId: target.device_id,
                kind: "push_notification",
                invalidatedAt: DateTime.formatIso(now),
              });
          }
          if (accepted) {
            yield* sql`UPDATE relay_bot_attention_receipts SET delivered_at=${DateTime.formatIso(now)} WHERE id=${id}`;
            delivered++;
          } else pending = true;
        }
        return {
          outcome: pending
            ? "retry"
            : delivered > 0
              ? "delivered"
              : !configured && eligibleDeviceSeen
                ? "configuration-required"
                : "no-device",
        } satisfies RelayBotAttentionResponse;
      },
      Effect.mapError((cause) =>
        isBotAttentionError(cause) ? cause : new BotAttentionError({ reason: "delivery", cause }),
      ),
    ),
  });
});
export const layer = Layer.effect(BotAttention, make);
