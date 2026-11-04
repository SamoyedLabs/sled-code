import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Maintenance from "./Maintenance.ts";

it.live("defaults to disabled and refuses an unconfigured release check before configuration", () =>
  Effect.gen(function* () {
    const first = yield* Effect.service(Maintenance.Maintenance).pipe(
      Effect.provide(Layer.fresh(Maintenance.layer).pipe(Layer.provide(harness().deps))),
    );
    expect((yield* first.get).policy).toBeNull();
    const result = yield* first.execute({ action: "check" }).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    expect((yield* first.get).proposals).toEqual([]);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Config.layerTest(process.cwd(), { prefix: "maintenance-" }),
        Sqlite.layerMemory,
      ).pipe(Layer.provide(NodeServices.layer)),
    ),
    Effect.scoped,
  ),
);

import {
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  EventId,
  ThreadId,
  type OpenbotMaintenancePolicy,
  type OpenbotUpstreamRelease,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Upstream from "./UpstreamRuntime.ts";
import * as Launch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Projects from "../orchestration-v2/ProjectStore.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
const projectId = ProjectId.make("integration");
const modelSelection = { instanceId: ProviderInstanceId.make("replay"), model: "free-review" };
const policy: OpenbotMaintenancePolicy = {
  enabled: true,
  intervalHours: 24,
  authority: "stage",
  projectId,
  modelSelection,
  baseRef: "HEAD",
  platform: "darwin-arm64",
};
const release: OpenbotUpstreamRelease = {
  version: "v0.61.0",
  releaseCommit: "a".repeat(40),
  releaseUrl: "https://github.com/nightly-labs/openbot/releases/tag/v0.61.0",
  publishedAt: "2026-11-04T00:00:00Z",
  sourceLicenseUrl: "https://example.test/license",
  sourceNoticeUrl: "https://example.test/notice",
  assets: [{ platform: "darwin-arm64", name: "OpenBot.zip", size: 42, sha256: "b".repeat(64) }],
  compatibility: "requires-validation",
};
function harness() {
  const commands: Launch.ThreadLaunchInput[] = [];
  let uncertain = true;
  let moved = false;
  let stages = 0;
  let due: Effect.Effect<void> = Effect.void;
  let checks = 0;
  const project = {
    projectId,
    title: "Integration",
    workspaceRoot: "/tmp/integration-fixture",
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
  };
  const deps = Layer.mergeAll(
    Layer.mock(Projects.ProjectStoreV2)({ get: () => Effect.succeedSome(project) }),
    Layer.mock(Providers.ProviderRegistry)({
      getProviders: Effect.succeed([
        {
          instanceId: modelSelection.instanceId,
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          installed: true,
          version: "1",
          showInteractionModeToggle: true,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-01-01T00:00:00Z",
          models: [
            {
              slug: modelSelection.model,
              name: "Free review",
              isCustom: false,
              capabilities: null,
            },
          ],
          slashCommands: [],
          skills: [],
        },
      ]),
    }),
    Layer.mock(Upstream.UpstreamRuntime)({
      checkLatest: Effect.sync(() => {
        checks++;
        return release;
      }),
      checkVersion: () =>
        Effect.sync(() => (moved ? { ...release, releaseCommit: "c".repeat(40) } : release)),
      stage: () =>
        Effect.sync(() => {
          stages++;
          return {
            ...release.assets[0]!,
            version: release.version,
            releaseCommit: release.releaseCommit,
            artifactPath: "/tmp/fixture/OpenBot.zip",
            stagedAt: "2026-11-04T01:00:00Z",
            compatibility: "requires-validation" as const,
            activation: "blocked" as const,
          };
        }),
    }),
    Layer.mock(Launch.ThreadLaunchService)({
      launch: (input) =>
        Effect.gen(function* () {
          commands.push(input);
          if (uncertain) {
            uncertain = false;
            return yield* new Launch.ThreadLaunchError({
              operation: "dispatch-message",
              commandId: input.commandId,
              projectId,
              cause: new Error("receipt lost"),
            });
          }
          const threadId = input.threadId!;
          const at = DateTime.makeUnsafe("2026-11-04T00:00:00Z");
          const projection = ProjectionStore.emptyProjection({
            type: "thread.created",
            id: EventId.make("created"),
            threadId,
            occurredAt: at,
            payload: {
              id: threadId,
              projectId,
              title: "Review",
              providerInstanceId: modelSelection.instanceId,
              modelSelection,
              runtimeMode: "approval-required",
              interactionMode: "plan",
              branch: null,
              worktreePath: null,
              activeProviderThreadId: null,
              lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
              forkedFrom: null,
              createdBy: "system",
              creationSource: "server",
              createdAt: at,
              updatedAt: at,
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              lastVisitedAt: null,
              deletedAt: null,
            },
          });
          return { threadId, projection, resumed: true };
        }),
    }),
    Layer.mock(Scheduler.Scheduler)({
      register: <E, R>(_name: string, work: Effect.Effect<void, E, R>) =>
        Effect.gen(function* () {
          const context = yield* Effect.context<R>();
          due = work.pipe(Effect.provideContext(context), Effect.orDie);
        }),
    }),
  );
  return {
    deps,
    commands,
    stages: () => stages,
    move: (value: boolean) => {
      moved = value;
    },
    due: () => due,
    checks: () => checks,
  };
}
it.live(
  "recovers uncertain review dispatch, persists decisions, and blocks changed release bytes without promoting compatibility",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const open = Effect.service(Maintenance.Maintenance).pipe(
        Effect.provide(Layer.fresh(Maintenance.layer).pipe(Layer.provide(h.deps))),
      );
      const service = yield* open;
      yield* service.execute({ action: "configure", expectedRevision: 0, policy });
      expect((yield* service.execute({ action: "check" }).pipe(Effect.result))._tag).toBe(
        "Failure",
      );
      let state = yield* service.get;
      const proposal = state.proposals[0]!;
      expect(proposal.state).toBe("review-queued");
      expect(proposal.report).toBeNull();
      const restarted = yield* open;
      state = yield* restarted.execute({ action: "review", proposalId: proposal.id });
      expect(h.commands.map((c) => c.commandId)).toEqual([
        proposal.reviewCommandId,
        proposal.reviewCommandId,
      ]);
      expect(h.commands[1]?.workspaceStrategy.type).toBe("worktree");
      expect(h.commands[1]?.runtimeMode).toBe("approval-required");
      expect(state.proposals[0]?.state).toBe("reviewing");
      const report = {
        sourceComparison: "Released API changed in the task routes.",
        findings: "Desktop acceptance is still outstanding.",
        evidence: [
          {
            kind: "desktop" as const,
            artifact: "artifacts/desktop-not-run.md",
            outcome: "not-run" as const,
          },
        ],
        decisionRequest: "Stage for isolated validation?",
      };
      expect(
        (yield* restarted
          .execute({
            action: "report",
            proposalId: proposal.id,
            threadId: ThreadId.make("other-thread"),
            report,
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      state = yield* restarted.execute({
        action: "report",
        proposalId: proposal.id,
        threadId: proposal.reviewThreadId!,
        report,
      });
      expect(state.proposals[0]?.state).toBe("decision-required");
      expect(
        (yield* restarted.execute({ action: "stage", proposalId: proposal.id }).pipe(Effect.result))
          ._tag,
      ).toBe("Failure");
      expect(
        (yield* restarted
          .execute({
            action: "decide",
            proposalId: proposal.id,
            expectedRevision: 0,
            accept: true,
            note: "Stale decision",
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      state = yield* restarted.execute({
        action: "decide",
        proposalId: proposal.id,
        expectedRevision: state.revision,
        accept: true,
        note: "Stage for isolated checks only.",
      });
      h.move(true);
      expect(
        (yield* restarted.execute({ action: "stage", proposalId: proposal.id }).pipe(Effect.result))
          ._tag,
      ).toBe("Failure");
      expect(h.stages()).toBe(0);
      h.move(false);
      state = yield* restarted.execute({ action: "stage", proposalId: proposal.id });
      expect(state.proposals[0]?.compatibility).toBe("requires-validation");
      expect(state.proposals[0]?.stagedAt).toBe("2026-11-04T01:00:00Z");
      expect(h.stages()).toBe(1);
      const final = yield* open;
      expect((yield* final.get).proposals[0]?.decision?.note).toBe(
        "Stage for isolated checks only.",
      );
      yield* final.execute({ action: "stage", proposalId: proposal.id });
      expect(h.stages()).toBe(1);
      // A second candidate keeps the already accepted review separate from a moved upstream tag.
      h.move(true);
      expect((yield* final.get).proposals[0]?.release.releaseCommit).toBe("a".repeat(40));

      state = yield* final.execute({
        action: "configure",
        expectedRevision: (yield* final.get).revision,
        policy: null,
      });
      expect(state.nextCheckAt).toBeNull();
      expect((yield* final.execute({ action: "check" }).pipe(Effect.result))._tag).toBe("Failure");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Config.layerTest(process.cwd(), { prefix: "maintenance-lifecycle-" }),
          Sqlite.layerMemory,
        ).pipe(Layer.provide(NodeServices.layer)),
      ),
      Effect.scoped,
    ),
);

it.live(
  "runs one due check through the shared scheduler and disabling prevents further scheduled work",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const service = yield* Effect.service(Maintenance.Maintenance).pipe(
        Effect.provide(Maintenance.layer.pipe(Layer.provide(h.deps))),
      );
      yield* service.execute({
        action: "configure",
        expectedRevision: 0,
        policy: { ...policy, authority: "check" },
      });
      yield* h.due();
      expect(h.checks()).toBe(1);
      expect((yield* service.get).proposals[0]?.state).toBe("proposed");
      yield* h.due();
      expect(h.checks()).toBe(1);
      yield* service.execute({
        action: "configure",
        expectedRevision: (yield* service.get).revision,
        policy: null,
      });
      yield* h.due();
      expect(h.checks()).toBe(1);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Config.layerTest(process.cwd(), { prefix: "maintenance-schedule-" }),
          Sqlite.layerMemory,
        ).pipe(Layer.provide(NodeServices.layer)),
      ),
      Effect.scoped,
    ),
);
