// @effect-diagnostics nodeBuiltinImport:off -- Local HTTP fixture verifies the owner-session instruction CAS contract.
import * as NodeHttp from "node:http";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type AuthMcpClientAccess,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Config from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Integration from "./Integration.ts";
import * as TeamClient from "./TeamClient.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as SledTools from "./SledTools.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as CodingPolicy from "./CodingPolicy.ts";

const scope = { hostId: "host", agentId: "bot" };
const defaults = {
  environmentId: EnvironmentId.make("local"),
  projectId: ProjectId.make("project"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  workspaceStrategy: { type: "root" as const },
};
const fixture = Effect.fnUntraced(function* () {
  let text = "User instructions must remain byte-for-byte intact.\n";
  let race = false;
  let writes = 0;
  let access: AuthMcpClientAccess = "full-access";
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeHttp.Server>((resolve) => {
          const server = NodeHttp.createServer(async (request, response) => {
            let input = "";
            for await (const chunk of request) input += chunk.toString();
            response.setHeader("content-type", "application/json");
            if (request.url === "/v1/auth/login") {
              response.end(
                JSON.stringify({ sessionToken: "owner-token", sessionExpiresAt: "2099-01-01" }),
              );
              return;
            }
            if (request.url === "/v1/auth/logout") {
              response.writeHead(204).end();
              return;
            }
            expect(request.headers.authorization).toBe("Bearer owner-token");
            if (request.url === "/v1/agents") {
              response.end(JSON.stringify([{ id: "bot", name: "Policy", provider: "codex" }]));
              return;
            }
            if (
              request.url !== "/v1/admin/agents/instructions" &&
              request.url !== "/v1/admin/agents/instructions/save"
            ) {
              response.writeHead(204).end();
              return;
            }
            const body = JSON.parse(input);
            if (body.agentId !== "bot") {
              response.writeHead(404).end("{}");
              return;
            }
            if (request.url === "/v1/admin/agents/instructions/save") {
              writes++;
              if (race) {
                text += "Concurrent user edit.\n";
                race = false;
              }
              if (body.expected !== text) {
                response.writeHead(409).end("{}");
                return;
              }
              text = body.text;
            }
            response.end(JSON.stringify({ fileName: "AGENTS.md", exists: true, text }));
          });
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string") return yield* Effect.die("Missing address");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const integration = Integration.layerWithHost("owner-secret").pipe(
    Layer.provide(TeamClient.layer),
    Layer.provide(
      Layer.mock(ManagedHost.ManagedHost)({
        getStatus: Effect.succeed({
          status: "ready",
          ready: {
            serverId: "host",
            serverName: "Policy",
            apiUrl,
            fingerprint: "fp",
            publicKey: "key",
            ownerMemberId: "owner",
          },
        }),
      }),
    ),
  );
  const layer = Layer.mergeAll(
    Config.layerTest(process.cwd(), { prefix: "t3-coding-policy-" }),
    Sqlite.layerMemory,
    integration,
    Layer.mock(SledTools.SledTools)({
      status: Effect.sync(() => ({ state: "connected" as const, hostId: "host", access })),
    }),
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("local")),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: (projectId) =>
        Effect.succeed(
          projectId === defaults.projectId
            ? Option.some({
                projectId,
                title: "Project",
                workspaceRoot: "/tmp/policy-project",
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                scripts: [],
                pinnedAt: null,
                archivedAt: null,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                deletedAt: null,
              })
            : Option.none(),
        ),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed([
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          installed: true,
          version: "1",
          showInteractionModeToggle: true,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-01-01T00:00:00Z",
          models: [{ slug: "model", name: "Model", isCustom: false, capabilities: null }],
          slashCommands: [],
          skills: [],
        },
      ]),
    }),
    Layer.mock(PeerLinks.PeerLinks)({ enabled: Effect.succeed(false) }),
    Layer.mock(PeerMcpClient.PeerMcpClient)({}),
  );
  return {
    layer,
    read: () => text,
    write: (value: string) => {
      text = value;
    },
    race: () => {
      race = true;
    },
    writes: () => writes,
    access: (value: AuthMcpClientAccess) => {
      access = value;
    },
  };
});
const open = Effect.service(CodingPolicy.CodingPolicy).pipe(
  Effect.provide(Layer.fresh(CodingPolicy.layer)),
);

it.live(
  "installs actionable coding defaults and removes only its owned block after reconstruction",
  () =>
    Effect.gen(function* () {
      const upstream = yield* fixture();
      yield* Effect.gen(function* () {
        const policy = yield* open;
        const original = upstream.read();
        expect((yield* policy.get(scope)).status).toBe("disabled");
        const enabled = yield* policy.enable({ ...scope, expectedRevision: 0, defaults });
        expect(enabled.status).toBe("enabled");
        expect(upstream.read()).toContain("openbot_coding");
        expect(upstream.read()).toContain('"taskId":null');
        expect(upstream.read().startsWith(original)).toBe(true);
        upstream.write(upstream.read() + "\nAnother user instruction.");
        const reconstructed = yield* open;
        expect((yield* reconstructed.get(scope)).revision).toBe(1);
        expect((yield* reconstructed.disable({ ...scope, expectedRevision: 1 })).status).toBe(
          "disabled",
        );
        expect(upstream.read()).toBe(original + "\nAnother user instruction.");
        expect((yield* policy.get({ ...scope, agentId: "other" })).status).toBe("disabled");
      }).pipe(Effect.provide(upstream.layer));
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, FetchHttpClient.layer)),
    ),
);

it.live(
  "refuses concurrent edits and stale revisions and reconstructs uncertain upstream success without rewriting",
  () =>
    Effect.gen(function* () {
      const upstream = yield* fixture();
      yield* Effect.gen(function* () {
        const policy = yield* open;
        upstream.race();
        expect(
          (yield* Effect.flip(policy.enable({ ...scope, expectedRevision: 0, defaults }))).reason,
        ).toBe("conflict");
        expect((yield* policy.get(scope)).status).toBe("pending");
        expect(upstream.writes()).toBe(1);
        expect((yield* policy.enable({ ...scope, expectedRevision: 0, defaults })).status).toBe(
          "enabled",
        );
        expect(upstream.read()).toContain("Concurrent user edit.");
        expect((yield* Effect.flip(policy.disable({ ...scope, expectedRevision: 0 }))).reason).toBe(
          "stale-revision",
        );
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TRIGGER fail_policy_commit BEFORE UPDATE OF config_json ON openbot_coding_policies WHEN NEW.pending_json IS NULL BEGIN SELECT RAISE(FAIL,'fixture commit failure'); END`;
        expect((yield* Effect.flip(policy.disable({ ...scope, expectedRevision: 1 }))).reason).toBe(
          "storage",
        );
        const writes = upstream.writes();
        yield* sql`DROP TRIGGER fail_policy_commit`;
        const rebuilt = yield* open;
        expect((yield* rebuilt.get(scope)).status).toBe("disabled");
        expect(upstream.writes()).toBe(writes);
        const enabled = yield* rebuilt.enable({ ...scope, expectedRevision: 2, defaults });
        upstream.write(upstream.read().replace("openbot_coding", "user-edited-tool"));
        expect((yield* rebuilt.get(scope)).status).toBe("conflict");
        expect(
          (yield* Effect.flip(rebuilt.disable({ ...scope, expectedRevision: enabled.revision })))
            .reason,
        ).toBe("conflict");
        expect(upstream.read()).toContain("user-edited-tool");
      }).pipe(Effect.provide(upstream.layer));
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, FetchHttpClient.layer)),
    ),
);

it.live(
  "does not expand a disconnected or insufficient bot grant or accept an unknown destination",
  () =>
    Effect.gen(function* () {
      const upstream = yield* fixture();
      yield* Effect.gen(function* () {
        const policy = yield* open;
        upstream.access("read-only");
        expect(
          (yield* Effect.flip(policy.enable({ ...scope, expectedRevision: 0, defaults }))).reason,
        ).toBe("tools-unavailable");
        upstream.access("full-access");
        expect(
          (yield* Effect.flip(
            policy.enable({
              ...scope,
              expectedRevision: 0,
              defaults: { ...defaults, environmentId: EnvironmentId.make("unknown") },
            }),
          )).reason,
        ).toBe("destination");
        expect(upstream.writes()).toBe(0);
      }).pipe(Effect.provide(upstream.layer));
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, FetchHttpClient.layer)),
    ),
);
