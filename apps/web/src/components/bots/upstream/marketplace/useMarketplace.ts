/* oxlint-disable react/set-state-in-effect -- Host reads publish pending and response state when the request identity changes. */
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { useEffect, useRef, useState } from "react";
import { settingRequest, settingResult } from "@t3tools/client-runtime/openbot/settings";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import type { Json } from "effect/Schema";
import {
  decodeAgentPage,
  decodeInstalled,
  decodeSkillPage,
  type AgentSummary,
  type SkillSummary,
  type InstalledSkill,
  type MarketplaceProps,
  type MarketplaceTab,
  type Source,
  type Category,
} from "./marketplace-model";
export function useMarketplace(
  props: MarketplaceProps,
  tab: MarketplaceTab,
  query: string,
  source: Source,
  category: Category | undefined,
  sort: "installs" | "updated" | "name",
) {
  const [page, setPage] = useState<{
    agents: readonly AgentSummary[];
    skills: readonly SkillSummary[];
    cursor: string | null;
  }>({ agents: [], skills: [], cursor: null });
  const [installed, setInstalled] = useState<Readonly<Record<string, readonly InstalledSkill[]>>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const generation = useRef(0);
  const skillsGeneration = useRef(0);
  const invoke = useStableCallback(
    async (operation: OpenbotSettingsRequest["operation"], parameters: Json) => {
      const request = settingRequest(operation, parameters);
      if (!request || !props.actions.can(request))
        throw new Error("You need permission to manage this host’s Marketplace.");
      const value = settingResult(operation, await props.actions.execute(request));
      if (value === null) throw new Error("The host returned an unsupported Marketplace response.");
      return value;
    },
  );
  const supported = props.capabilities.includes("local-skill-catalog-v1");
  const read = useStableCallback(async (cursor?: string) => {
    const version = ++generation.current;
    if (tab === "apps") {
      setBusy(false);
      setError(null);
      return;
    }
    if (!supported) {
      setBusy(false);
      setError("This host does not expose Marketplace browsing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parameters = {
        query,
        limit: 50,
        ...(source === "all" ? {} : { verified: source === "verified" }),
        ...(category ? { category } : {}),
        ...(tab === "skills" ? { sort } : {}),
        ...(cursor ? { cursor } : {}),
      };
      const result = await invoke(
        tab === "agents"
          ? "settings.local-catalog.searchAgents"
          : "settings.local-catalog.searchSkills",
        parameters,
      );
      if (version !== generation.current) return;
      if (tab === "agents") {
        const next = decodeAgentPage(result);
        setPage((previous) => ({
          ...previous,
          agents: cursor
            ? [
                ...previous.agents,
                ...next.agents.filter((item) => !previous.agents.some((old) => old.id === item.id)),
              ]
            : next.agents,
          cursor: next.nextCursor,
        }));
      } else {
        const next = decodeSkillPage(result);
        setPage((previous) => ({
          ...previous,
          skills: cursor
            ? [
                ...previous.skills,
                ...next.skills.filter((item) => !previous.skills.some((old) => old.id === item.id)),
              ]
            : next.skills,
          cursor: next.nextCursor,
        }));
      }
    } catch (cause) {
      if (version === generation.current)
        setError(cause instanceof Error ? cause.message : "The Marketplace could not be loaded.");
    } finally {
      if (version === generation.current) setBusy(false);
    }
  });
  const readSkills = useStableCallback(async () => {
    const generation = ++skillsGeneration.current;
    if (!props.capabilities.includes("skills-admin-v1")) return;
    setSkillError(null);
    const results = await Promise.allSettled(
      props.agents.map(async (agent) => ({
        id: agent.id,
        skills: decodeInstalled(await invoke("settings.skills-admin.list", { agentId: agent.id })),
      })),
    );
    if (generation !== skillsGeneration.current) return;
    const next: Record<string, readonly InstalledSkill[]> = {};
    for (const result of results) {
      if (result.status === "fulfilled") next[result.value.id] = result.value.skills;
      else
        setSkillError("Some agents’ skills could not be read. Retry before changing their skills.");
    }
    setInstalled(next);
  });
  const requestKey = JSON.stringify([
    props.scopeKey,
    tab,
    query,
    source,
    category,
    sort,
    supported,
  ]);
  const agentKey = JSON.stringify(props.agents.map((agent) => agent.id));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The catalog is external host state; invalidate late replies when its request changes or the page closes.
  useEffect(() => {
    setPage({ agents: [], skills: [], cursor: null });
    if (requestKey) void read();
    return () => {
      generation.current += 1;
    };
  }, [requestKey, read]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Installed skills belong to the selected host and its current agent list.
  useEffect(() => {
    if (tab === "skills" && props.scopeKey && agentKey) void readSkills();
    return () => {
      skillsGeneration.current += 1;
    };
  }, [props.scopeKey, tab, agentKey, readSkills]);
  return {
    ...page,
    installed,
    busy,
    error,
    skillError,
    reload: () => void read(),
    more: () => {
      if (page.cursor && !busy) void read(page.cursor);
    },
    refreshSkills: () => readSkills(),
  };
}
