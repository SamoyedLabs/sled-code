import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry } from "effect/reactivity";
import { createRuntimeCommand } from "../state/runtime.ts";
import { openbotAdminCommandKey } from "./browserNavigation.ts";

it.live(
  "keeps browser reads and Stop responsive while serializing navigations and configuration",
  () =>
    Effect.gen(function* () {
      const release = Latch.makeUnsafe();
      const started = Latch.makeUnsafe();
      const events: string[] = [];
      const registry = AtomRegistry.make();
      const command = createRuntimeCommand(Atom.runtime(Layer.empty), {
        label: "test.browser-navigation",
        concurrency: {
          mode: "serial",
          key: (operation: string) => openbotAdminCommandKey("owned", operation),
        },
        execute: (operation: string) =>
          Effect.gen(function* () {
            events.push(operation);
            if (operation === "browser.load") {
              started.openUnsafe();
              yield* release.await;
            }
            return operation;
          }),
      });
      const load = yield* Effect.forkChild(command.run(registry, "browser.load"));
      yield* started.await;
      const reload = yield* Effect.forkChild(command.run(registry, "browser.reload"));
      const display = yield* Effect.forkChild(command.run(registry, "browser.display"));
      const stop = yield* Effect.forkChild(command.run(registry, "browser.stop"));
      try {
        yield* Effect.all([Fiber.join(display), Fiber.join(stop)], {
          concurrency: "unbounded",
        }).pipe(Effect.timeout("1 second"));
        expect(events).toEqual(["browser.load", "browser.display", "browser.stop"]);
        expect(openbotAdminCommandKey("owned", "agent.delete")).toBe(
          openbotAdminCommandKey("owned", "agent.update"),
        );
        expect(openbotAdminCommandKey("other", "browser.load")).not.toBe(
          openbotAdminCommandKey("owned", "browser.load"),
        );
      } finally {
        release.openUnsafe();
        yield* Effect.all(
          [Fiber.join(load), Fiber.join(reload), Fiber.join(display), Fiber.join(stop)],
          { concurrency: "unbounded" },
        );
        registry.dispose();
      }
    }),
);
