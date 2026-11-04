import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { OpenbotVaultRequest } from "@t3tools/contracts";
import * as Vault from "./VaultProtocol.ts";

const isRequest = Schema.is(OpenbotVaultRequest);

describe("released vault boundary", () => {
  it.effect("uses explicit versioned routes and strips secrets from lists", () =>
    Effect.gen(function* () {
      expect(Vault.route({ operation: "vault.list", version: "v1" })).toMatchObject({
        method: "POST",
        path: "/v1/admin/vault/list",
        body: {},
      });
      expect(
        Vault.route({ operation: "vault.reveal", version: "v2", id: "one", field: "key" }),
      ).toMatchObject({ path: "/v1/admin/vault/v2/reveal", body: { id: "one", field: "key" } });
      expect(
        yield* Vault.project("vault.list", {
          status: "ready",
          items: [
            { kind: "apiKey", id: "one", name: "TOKEN", notes: "", hasKey: true, key: "PRIVATE" },
          ],
        }),
      ).toEqual({
        status: "ready",
        items: [{ kind: "apiKey", id: "one", name: "TOKEN", notes: "", hasKey: true }],
      });
      expect(yield* Vault.project("vault.reveal", { value: "PRIVATE", token: "hidden" })).toEqual({
        value: "PRIVATE",
      });
    }),
  );
  it.effect("redacts connector diagnostics and private URL components", () =>
    Effect.gen(function* () {
      expect(
        yield* Vault.project("vault.bitwarden.status", {
          state: "connected",
          serverUrl: "https://user:secret@vault.example/a?token=secret",
          error: "secret",
        }),
      ).toEqual({
        state: "connected",
        serverUrl: "https://vault.example",
        error: "The host password-manager connection failed.",
      });
      expect(
        yield* Vault.project("vault.onepassword.status", {
          state: "future",
          vaultNames: ["private"],
          loginCount: 1,
          error: null,
        }),
      ).toEqual({ state: "disconnected", vaultNames: [], loginCount: null, error: null });
    }),
  );
  it("refuses unsupported v1 keys, arbitrary routes and oversized imports", () => {
    expect(
      isRequest({
        operation: "vault.reveal",
        version: "v1",
        id: "one",
        field: "key",
      }),
    ).toBe(false);
    expect(
      isRequest({
        operation: "vault.save",
        version: "v1",
        input: { kind: "apiKey", id: null, name: "TOKEN", notes: "", key: "secret" },
      }),
    ).toBe(false);
    expect(isRequest({ operation: "vault.import", csv: "x".repeat(262145) })).toBe(false);
    expect(isRequest({ operation: "vault.proxy", path: "/secret" })).toBe(false);
  });
});
it.effect("enforces the frozen v1 reveal limit", () =>
  Effect.gen(function* () {
    expect(
      (yield* Effect.result(Vault.project("vault.reveal", { value: "x".repeat(1025) }, "v1")))._tag,
    ).toBe("Failure");
  }),
);
