import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Profiles from "./ProfileRecovery.ts";
const identity = {
  releaseCommit: "a".repeat(40),
  patchSetSha256: "b".repeat(64),
  artifactSha256: "c".repeat(64),
  profileSchemaVersion: "1",
  fixtureVersion: "fixture-1",
};
it.effect.each(["abort", "rollback"] as const)(
  "restores exact task-owned profile bytes after %s and reconstructs durable state",
  (action) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const stateDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "sled-openbot-profile-" });
      const profileLayer = Profiles.layer({ stateDirectory });
      const home = path.join(stateDirectory, "openbot", "maintenance-profiles", "check");
      yield* fs.makeDirectory(path.join(home, "seed"), { recursive: true });
      yield* fs.writeFileString(
        path.join(home, "seed", "state.json"),
        "original schema-one profile",
      );
      yield* Effect.gen(function* () {
        const profiles = yield* Profiles.ProfileRecovery;
        expect((yield* profiles.prepare({ id: "check", identity })).state).toBe("prepared");
        yield* profiles.transition("check", "prepared", "migrate");
        yield* fs.writeFileString(
          path.join(home, "working", "state.json"),
          "partial incompatible schema-two profile",
        );
        if (action === "abort") yield* profiles.transition("check", "migrating", "abort");
        else yield* profiles.transition("check", "migrating", "complete");
      }).pipe(Effect.provide(profileLayer));
      yield* Effect.gen(function* () {
        const profiles = yield* Profiles.ProfileRecovery;
        expect((yield* profiles.get("check")).identity).toEqual(identity);
        const state = action === "abort" ? "aborted" : "ready";
        const restored = yield* profiles.transition(
          "check",
          state,
          action === "abort" ? "restore" : "rollback",
        );
        expect(restored.state).toBe(action === "abort" ? "restored" : "rolled-back");
        expect(yield* fs.readFileString(path.join(home, "working", "state.json"))).toBe(
          "original schema-one profile",
        );
        expect(yield* fs.readFileString(path.join(home, "failed-working", "state.json"))).toContain(
          "incompatible",
        );
        const stale = yield* profiles.transition("check", state, "rollback").pipe(Effect.flip);
        expect(stale.reason).toBe("state");
      }).pipe(Effect.provide(profileLayer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("rejects escaping job identities and profile links before backup", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path;
    const stateDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "sled-openbot-profile-" });
    const outside = yield* fs.makeTempDirectoryScoped({ prefix: "sled-openbot-outside-" });
    yield* Effect.gen(function* () {
      const profiles = yield* Profiles.ProfileRecovery;
      expect((yield* profiles.directory("../outside").pipe(Effect.flip)).reason).toBe("path");
      const home = yield* profiles.directory("links");
      yield* fs.makeDirectory(path.join(home, "seed"), { recursive: true });
      yield* fs.writeFileString(path.join(outside, "credential"), "private");
      yield* fs.symlink(path.join(outside, "credential"), path.join(home, "seed", "linked"));
      expect((yield* profiles.prepare({ id: "links", identity }).pipe(Effect.flip)).reason).toBe(
        "path",
      );
      expect(yield* fs.exists(path.join(home, "backup"))).toBe(false);
    }).pipe(Effect.provide(Profiles.layer({ stateDirectory })));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
