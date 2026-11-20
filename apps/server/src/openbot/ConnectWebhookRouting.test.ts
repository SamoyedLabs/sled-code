import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { ScheduledTaskWebhookOrigin } from "../scheduledTasks/ScheduledTaskService.ts";
import * as Routing from "./ConnectWebhookRouting.ts";

it.effect("binds stable webhook addresses to the owning environment, host and native route", () =>
  Effect.gen(function* () {
    const routing = yield* Routing.ConnectWebhookRouting;
    expect(routing).not.toBeNull();
    if (!routing) return;
    const url = yield* routing.address("host-a", "route-a");
    expect(url).toMatch(/^https:\/\/relay.example\/v1\/hooks\/0123456789abcdef\/bot\./);
    const parts = new URL(url!).pathname.split("/");
    const hookId = decodeURIComponent(parts[4]!);
    const token = parts[5]!;
    expect(routing.target(hookId, token)).toEqual({ hostId: "host-a", routeId: "route-a" });
    expect(routing.target(hookId, `${token.slice(0, -1)}!`)).toBeNull();
    expect(routing.target("bot.e30", token)).toBeNull();
    const other = yield* routing.address("host-b", "route-a");
    expect(other).not.toBe(url);
    expect(yield* routing.address("host-a", "route-a")).toBe(url);
  }).pipe(
    Effect.provide(
      Routing.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ServerSecretStore.ServerSecretStore)({
              getOrCreateRandom: () => Effect.succeed(new Uint8Array(32).fill(19)),
            }),
            Layer.succeed(
              ScheduledTaskWebhookOrigin,
              Effect.succeed({
                relayHookBaseUrl: "https://relay.example/v1/hooks/0123456789abcdef",
              }),
            ),
          ),
        ),
      ),
    ),
  ),
);

it.effect("does not invent a public URL before this host is linked to Sled Connect", () =>
  Effect.gen(function* () {
    const routing = yield* Routing.ConnectWebhookRouting;
    expect(yield* routing!.address("host-a", "route-a")).toBeNull();
  }).pipe(
    Effect.provide(
      Routing.layer.pipe(
        Layer.provide(
          Layer.mock(ServerSecretStore.ServerSecretStore)({
            getOrCreateRandom: () => Effect.succeed(new Uint8Array(32).fill(19)),
          }),
        ),
      ),
    ),
  ),
);
