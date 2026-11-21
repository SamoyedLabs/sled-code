import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";
import { project, route } from "./TemplateProtocol.ts";
it.effect(
  "projects publication review without host paths, credentials, commands or original account metadata",
  () =>
    Effect.gen(function* () {
      const value = {
        agentId: "agent",
        name: "A",
        title: "T",
        description: "public",
        updatedAt: null,
        publication: null,
        skillsError: null,
        skills: [],
        routines: [],
        avatarUrl: "/private/avatar",
        credentials: "secret",
        command: "private-command",
        account: { token: "secret" },
      };
      const result = yield* project("templates.preview", value);
      expect(result).toEqual({
        agentId: "agent",
        name: "A",
        title: "T",
        description: "public",
        updatedAt: null,
        publication: null,
        skillsError: null,
        skills: [],
        routines: [],
      });
      const invalid = yield* project("templates.preview", {
        ...value,
        skills: [{ kind: "command", command: "private" }],
      }).pipe(Effect.result);
      expect(invalid._tag).toBe("Failure");
    }),
);

it("uses fixed released routes and carries the original revision/receipt with no custom commands", () => {
  expect(
    route({
      operation: "templates.installMarketplace",
      listingId: "a/b",
      timezone: "UTC",
      receiptId: "receipt",
    }),
  ).toMatchObject({
    path: "/v1/admin/agents/install-marketplace",
    body: { listingId: "a/b", timezone: "UTC", receiptId: "receipt" },
  });
  expect(
    route({
      operation: "templates.install",
      templateId: "id",
      timezone: "UTC",
      expectedUpdatedAt: "rev",
    }).body,
  ).toEqual({ templateId: "id", timezone: "UTC", expectedUpdatedAt: "rev" });
  expect(route({ operation: "templates.publish", agentId: "id" }).body).toEqual({
    agentId: "id",
    card: null,
  });
});
it.effect(
  "uses actual durable adoption routes and projects status without account or workspace data",
  () =>
    Effect.gen(function* () {
      expect(
        route({
          operation: "templates.adopt",
          operationId: "original",
          kind: "template",
          sourceId: "source",
          timezone: "UTC",
          expectedRevision: "reviewed",
        }),
      ).toMatchObject({
        path: "/v1/admin/agents/adoption/install",
        body: {
          operationId: "original",
          kind: "template",
          sourceId: "source",
          timezone: "UTC",
          expectedRevision: "reviewed",
        },
      });
      expect(
        yield* project("templates.adopt", {
          operationId: "original",
          kind: "template",
          sourceId: "source",
          state: "interrupted",
          agentId: "retained",
          name: "Homework",
          accountToken: "secret",
          workspacePath: "/private",
        }),
      ).toEqual({
        operationId: "original",
        kind: "template",
        sourceId: "source",
        state: "interrupted",
        agentId: "retained",
        name: "Homework",
      });
    }),
);
