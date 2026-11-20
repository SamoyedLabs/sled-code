import type { EnvironmentId } from "@t3tools/contracts";

type WorkspaceEnvironment = {
  environmentId: EnvironmentId;
};

export function selectWorkspaceEnvironment<T extends WorkspaceEnvironment>(
  environments: readonly T[],
  selected: EnvironmentId | null,
) {
  return selected === null
    ? environments[0]
    : environments.find((item) => item.environmentId === selected);
}
