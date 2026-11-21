import type { EnvironmentId } from "@t3tools/contracts";
import { openbot } from "../../../state/openbot";
import { useEnvironmentQuery } from "../../../state/query";
import { decodePeople, decodeSelf, decodeDirectThreads } from "./directModel";

export function useBotPeople(environmentId: EnvironmentId, hostId: string | null) {
  const people = useEnvironmentQuery(
    hostId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "direct.people" } },
        })
      : null,
  );
  const self = useEnvironmentQuery(
    hostId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "direct.self" } },
        })
      : null,
  );
  const threads = useEnvironmentQuery(
    hostId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "direct.threads" } },
        })
      : null,
  );
  const persons = decodePeople(people.data),
    own = decodeSelf(self.data),
    summaries = decodeDirectThreads(threads.data);
  return {
    members: persons._tag === "Some" ? persons.value.members : [],
    selfId: own._tag === "Some" ? own.value.id : null,
    threads: summaries._tag === "Some" ? summaries.value : [],
    error: people.error ?? self.error ?? threads.error,
    refresh: () => {
      people.refresh();
      self.refresh();
      threads.refresh();
    },
  };
}
