import { expect, it } from "@effect/vitest";
import { resolveRuntimeExecutable } from "./RuntimeExecutable.ts";
it("keeps overrides fixed and validated updates ahead of the bundled baseline without requiring a local host", () => {
  expect(
    resolveRuntimeExecutable({
      override: "/override",
      installed: "/validated",
      bundled: "/bundle",
    }),
  ).toEqual({ executablePath: "/override", allowExecutableSwitch: false });
  expect(resolveRuntimeExecutable({ installed: "/validated", bundled: "/bundle" })).toEqual({
    executablePath: "/validated",
    allowExecutableSwitch: true,
  });
  expect(resolveRuntimeExecutable({ bundled: "/bundle" })).toEqual({
    executablePath: "/bundle",
    allowExecutableSwitch: true,
  });
  expect(resolveRuntimeExecutable({})).toEqual({
    executablePath: undefined,
    allowExecutableSwitch: true,
  });
});
