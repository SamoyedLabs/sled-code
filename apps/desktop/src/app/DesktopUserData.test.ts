import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["t3code", "T3 Code (Alpha)"])(
  "preserves Windows credential keys from %s without copying browser databases",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-profile-" });
      const source = path.join(directory, sourceName);
      const destination = path.join(directory, "t3code-v2");
      const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
      yield* fs.makeDirectory(path.join(directory, "T3 Code (Alpha)"), { recursive: true });
      yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), state);
      yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
      assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
      assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
      yield* fs.writeFileString(path.join(destination, "Local State"), "existing V2 state");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "existing V2 state",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// Materialized in the existing DesktopUserData.test.ts suite.
it.effect.each(["darwin", "win32", "linux"] as const)(
  "keeps an explicitly isolated %s profile away from existing Chromium data",
  (platform) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-isolated-profile-" });
      const appDataDirectory = path.join(root, "regular");
      const electronUserDataDirectory = path.join(root, "isolated");
      yield* fs.makeDirectory(path.join(appDataDirectory, "T3 Code (Alpha)"), { recursive: true });
      const oldState = path.join(appDataDirectory, "T3 Code (Alpha)/Local State");
      yield* fs.writeFileString(oldState, "existing profile must stay untouched");
      const result = yield* resolveUserDataPath({
        appDataDirectory,
        electronUserDataDirectory,
        isDevelopment: false,
        platform,
      });
      assert.equal(result, path.join(electronUserDataDirectory, "t3code-v2"));
      assert.equal(yield* fs.readFileString(oldState), "existing profile must stay untouched");
      assert.isFalse(yield* fs.exists(path.join(result, "Local State")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
