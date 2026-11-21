import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type { EnvironmentId } from "@t3tools/contracts";
import { providerModels, providerStatus } from "@t3tools/client-runtime/openbot/presentation";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
const Connections = Schema.Struct({
  connections: Schema.Array(
    Schema.Struct({
      connectionId: Schema.String,
      connectionName: Schema.String,
      platform: Schema.String,
      placesFailed: Schema.Boolean,
      places: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
    }),
  ),
});
const Github = Schema.Struct({
  connected: Schema.Boolean,
  repositories: Schema.Array(
    Schema.Struct({
      fullName: Schema.String,
      private: Schema.Boolean,
      canWrite: Schema.Boolean,
      events: Schema.Boolean,
    }),
  ),
});
export const GithubOptions = Schema.Struct({
  labels: Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String })),
  people: Schema.Array(Schema.String),
});
export function decoded<A>(schema: Schema.Decoder<A>, value: unknown): A | null {
  const result = Schema.decodeUnknownResult(schema)(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function useWorkflowCatalogs(
  environmentId: EnvironmentId,
  hostId: string,
  canManage: boolean,
) {
  const models = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.models" } },
    }),
  );
  const status = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.status" } },
    }),
  );
  const places = useEnvironmentQuery(
    canManage
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.routine-results.options", parameters: {} },
          },
        })
      : null,
  );
  const github = useEnvironmentQuery(
    canManage
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.workflows-github.catalog", parameters: {} },
          },
        })
      : null,
  );
  return {
    models: providerModels(models.data) ?? [],
    providers: providerStatus(status.data) ?? [],
    connections: decoded(Connections, places.data)?.connections ?? [],
    github: decoded(Github, github.data),
    modelsError: models.error ?? status.error,
    placesError: places.error,
    githubError: github.error,
  };
}
export type WorkflowCatalogs = ReturnType<typeof useWorkflowCatalogs>;
