// @effect-diagnostics nodeBuiltinImport:off -- This test exercises a standalone Node launcher outside the Effect runtime.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { privateDesktopLaunchEnvironment } from "./private-desktop-launch.ts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { createBuildConfig } from "./build-desktop-artifact.ts";

const readMac = Schema.decodeUnknownSync(
  Schema.Struct({
    mac: Schema.Struct({ extendInfo: Schema.Record(Schema.String, Schema.Unknown) }),
  }),
);

it.effect("private desktop launch preserves its isolated profile when opened in Finder", () =>
  Effect.gen(function* () {
    const config = yield* createBuildConfig(
      "mac",
      "zip",
      "0.1.4-nightly.20261028.3824",
      false,
      false,
      undefined,
      undefined,
    );
    assert.deepStrictEqual(readMac(config).mac.extendInfo.LSEnvironment, {
      T3CODE_HOME: "/private/t3-remote-desktop",
      T3CODE_DISABLE_AUTO_UPDATE: "true",
      T3CODE_RELAY_URL: "https://relay.example.test",
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "public-client",
      T3CODE_CLERK_JWT_TEMPLATE: "public-template",
    });
  }).pipe(
    Effect.provide([
      NodeServices.layer,
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_DESKTOP_PRIVATE_BUILD: "true",
            T3CODE_DESKTOP_PRIVATE_HOME: "/private/t3-remote-desktop",
            T3CODE_RELAY_URL: "https://relay.example.test",
            T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_public",
            T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "public-client",
            T3CODE_CLERK_JWT_TEMPLATE: "public-template",
            PRIVATE_API_TOKEN: "must-never-be-bundled",
          },
        }),
      ),
    ]),
  ),
);

it.effect("private desktop launch settings do not change normal packages", () =>
  Effect.gen(function* () {
    const config = yield* createBuildConfig(
      "mac",
      "zip",
      "0.1.4-nightly.20261028.3824",
      false,
      false,
      undefined,
      undefined,
    );
    assert.isUndefined(readMac(config).mac.extendInfo.LSEnvironment);
  }).pipe(
    Effect.provide([
      NodeServices.layer,
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_DESKTOP_PRIVATE_HOME: "/private/t3-remote-desktop",
          },
        }),
      ),
    ]),
  ),
);

it.effect("private desktop launch refuses a missing isolated profile", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      createBuildConfig(
        "mac",
        "zip",
        "0.1.4-nightly.20261028.3824",
        false,
        false,
        undefined,
        undefined,
      ),
    );
    assert.isTrue(Exit.isFailure(result));
  }).pipe(
    Effect.provide([
      NodeServices.layer,
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_DESKTOP_PRIVATE_BUILD: "true",
          },
        }),
      ),
    ]),
  ),
);

it.effect("private desktop launch refuses a relative profile", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      createBuildConfig(
        "mac",
        "zip",
        "0.1.4-nightly.20261028.3824",
        false,
        false,
        undefined,
        undefined,
      ),
    );
    assert.isTrue(Exit.isFailure(result));
  }).pipe(
    Effect.provide([
      NodeServices.layer,
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_DESKTOP_PRIVATE_BUILD: "true",
            T3CODE_DESKTOP_PRIVATE_HOME: "relative-profile",
          },
        }),
      ),
    ]),
  ),
);

it.effect(
  "private project profile inside the projects directory stays isolated from live userdata",
  () =>
    Effect.sync(() => {
      const home = NodePath.join(
        NodeOS.homedir(),
        ".t3",
        "projects",
        "remote-test",
        ".tools",
        "home",
      );
      assert.strictEqual(privateDesktopLaunchEnvironment(home, {}).T3CODE_HOME, home);
      assert.throws(() =>
        privateDesktopLaunchEnvironment(NodePath.join(NodeOS.homedir(), ".t3"), {}),
      );
      assert.throws(() =>
        privateDesktopLaunchEnvironment(
          NodePath.join(NodeOS.homedir(), ".t3", "userdata", "nested"),
          {},
        ),
      );
    }),
);
