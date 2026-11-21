import { serializeBotReference } from "../../../settings/botComposerModel";
import { SourceSwitch } from "../settings/SourceSwitch";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CalendarClock, Plus, UsersRound } from "lucide-react";
import { settingRequest, settingResult } from "@t3tools/client-runtime/openbot/settings";
import {
  templateInstall,
  templateHistoryRequest,
  templateSchedule,
} from "@t3tools/client-runtime/openbot/templates";
import { useBotTemplates } from "../../../settings/useBotTemplates";
import { confirmed } from "../../../settings/BotConnectionControls";
import { randomUUID } from "../../../../lib/utils";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../ui/dialog";
import {
  SourceButton,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "../settings/SettingsParts";
import { Avatar, DetailHeader, Information, SkillMark } from "./MarketplaceParts";
import {
  CATEGORY_LABELS,
  decodeSkill,
  type Listing,
  type SkillDetail,
  type MarketplaceProps,
  type InstalledSkill,
} from "./marketplace-model";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import type { Json } from "effect/Schema";

export function MarketplaceDetail({
  listing,
  model,
  installed,
  refreshSkills,
}: {
  listing: Listing;
  model: MarketplaceProps;
  installed: Readonly<Record<string, readonly InstalledSkill[]>>;
  refreshSkills: () => Promise<void>;
}) {
  return listing.kind === "agent" ? (
    <AgentDetail listing={listing.value} model={model} />
  ) : (
    <SkillDetailPage
      listing={listing.value}
      local={listing.local === true}
      model={model}
      installed={installed}
      refreshSkills={refreshSkills}
    />
  );
}
function AgentDetail({
  listing,
  model,
}: {
  listing: Extract<Listing, { kind: "agent" }>["value"];
  model: MarketplaceProps;
}) {
  const adoption = model.capabilities.includes("agent-adoption-v1");
  // Review and history share one controller lock. Run them in order so the initial
  // history read cannot silently discard the listing review on mount.
  const c = useBotTemplates(model.scopeKey, model.templates, false);
  const [operationId, setOperationId] = useState(randomUUID);
  const detail =
    c.state.review?.kind === "marketplace" && c.state.review.detail.id === listing.id
      ? c.state.review.detail
      : null;
  const target = model.agents.find((agent) => agent.listingId === listing.id);
  const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const request =
    detail && adoption
      ? templateInstall(
          c.state,
          timezone,
          operationId,
          target ? { agentId: target.id, listingId: listing.id } : undefined,
          true,
        )
      : null;
  const read = useStableCallback(async () => {
    if (await c.run({ operation: "templates.listing", listingId: listing.id })) {
      if (adoption) await c.run({ operation: "templates.adoptions" });
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Review this exact host listing before offering its pinned durable adoption request.
  useEffect(() => {
    if (listing.id) void read();
  }, [listing.id, read]);
  const add = async () => {
    if (!request || !model.templates.can(request)) return;
    if (
      !(await confirmed(
        `${target ? "Update" : "Add"} ${listing.name} with ${detail?.skills.length ?? 0} skills and ${detail?.routines.length ?? 0} routines on this host? Routine timezone: ${timezone}.`,
      ))
    )
      return;
    if (await c.run(request)) setOperationId(randomUUID());
  };
  return (
    <div className="marketplace-view">
      <div className="integration-page marketplace-skill-page">
        <DetailHeader
          name={listing.name}
          logo={<Avatar agent={listing} />}
          verified={listing.verified}
          subtitle={`${listing.title} · by ${listing.creatorName}`}
          status={target ? "connected" : "idle"}
          statusLabel={target ? "Added" : "Not added"}
          actions={
            <>
              {target && model.onOpenAgent && (
                <SourceButton onClick={() => model.onOpenAgent?.(target.id)}>
                  Open chat
                </SourceButton>
              )}
              <SourceButton
                disabled={c.busy || !request || !model.templates.can(request)}
                onClick={() => void add()}
              >
                <Plus aria-hidden="true" />
                {target ? "Update" : "Add agent"}
              </SourceButton>
            </>
          }
        />
        {!listing.verified && !model.capabilities.includes("sled-public-catalog-v1") && (
          <p className="ui-text marketplace-agent-trust" data-variant="caption" data-tone="muted">
            <UsersRound aria-hidden="true" />
            {detail?.pending
              ? "Shared by its creator before OpenBot reviewed it."
              : "Made by another OpenBot user. OpenBot reviewed it before it went live."}
          </p>
        )}
        {c.busy && !detail && <p role="status">Loading agent details…</p>}
        {c.error && (
          <p role="alert">
            {c.error}
            <SourceButton onClick={() => void read()}>Retry</SourceButton>
          </p>
        )}
        {detail?.pending && (
          <p role="status">This listing is awaiting review. Adding is unavailable.</p>
        )}
        {detail && (
          <>
            <SettingsSection title="Skills">
              <SettingsCard>
                {detail.skills.map((skill) => (
                  <SettingsRow
                    key={skill.slug}
                    title={skill.name}
                    description={
                      skill.kind === "marketplace" ? `Version ${skill.version}` : "Included skill"
                    }
                  />
                ))}
              </SettingsCard>
            </SettingsSection>
            <SettingsSection title="Routines">
              <SettingsCard>
                {detail.routines.map((routine) => (
                  <SettingsRow
                    key={routine.name}
                    title={routine.name}
                    description={`${templateSchedule(routine.schedule)}${routine.active ? "" : " · Inactive"}`}
                  >
                    <CalendarClock aria-hidden="true" />
                  </SettingsRow>
                ))}
              </SettingsCard>
            </SettingsSection>
          </>
        )}
        <Information
          description={detail?.description ?? listing.description}
          facts={[
            { label: "Creator", value: listing.creatorName },
            {
              label: "Source",
              value: model.capabilities.includes("sled-public-catalog-v1")
                ? "Public OpenBot catalog"
                : listing.verified
                  ? "Verified by OpenBot"
                  : "Public",
            },
            ...(listing.category
              ? [{ label: "Category", value: CATEGORY_LABELS[listing.category] }]
              : []),
            { label: "Version", value: listing.version },
            {
              label: model.capabilities.includes("sled-public-catalog-v1") ? "Bundled" : "Updated",
              value: new Date(listing.updatedAt).toLocaleDateString(),
            },
          ]}
        />
        {c.state.notice && <p role="status">{c.state.notice}</p>}
        {c.state.uncertain && (
          <SettingsSection title="Installation status">
            <SettingsCard>
              <div className="integration-card-body">
                <p>
                  The host outcome is not yet confirmed. Refresh to recover the original
                  installation.
                </p>
                <SourceButton
                  disabled={c.busy}
                  onClick={() => void c.run(templateHistoryRequest(c.state))}
                >
                  Refresh installation status
                </SourceButton>
                {c.state.adoptions.map((item) => (
                  <SettingsRow
                    key={item.operationId}
                    title={item.name ?? item.sourceId}
                    description={item.state}
                  >
                    {(item.state === "failed" || item.state === "interrupted") && item.agentId && (
                      <SourceButton
                        onClick={() =>
                          void confirmed(
                            `Have you inspected retained agent ${item.agentId} on this host? Its work will remain on the host.`,
                          ).then((ok) => {
                            if (ok) c.acknowledge(item.operationId);
                          })
                        }
                      >
                        I inspected this agent
                      </SourceButton>
                    )}
                  </SettingsRow>
                ))}
              </div>
            </SettingsCard>
          </SettingsSection>
        )}
      </div>
    </div>
  );
}
function SkillDetailPage({
  listing,
  local,
  model,
  installed,
  refreshSkills,
}: {
  listing: Extract<Listing, { kind: "skill" }>["value"];
  local: boolean;
  model: MarketplaceProps;
  installed: Readonly<Record<string, readonly InstalledSkill[]>>;
  refreshSkills: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const lock = useRef(false);
  const have = model.agents.filter((agent) =>
    installed[agent.id]?.some((skill) => skill.skillId === listing.id),
  );
  const request = (operation: OpenbotSettingsRequest["operation"], parameters: Json) =>
    settingRequest(operation, parameters);
  const execute = async (operation: OpenbotSettingsRequest["operation"], parameters: Json) => {
    const next = request(operation, parameters);
    if (!next || !model.actions.can(next))
      throw new Error("You need permission to change skills on this host.");
    const response = settingResult(operation, await model.actions.execute(next));
    if (response === null)
      throw new Error("The host returned an unsupported skill response. Refresh before retrying.");
    return response;
  };
  const read = useStableCallback(async () => {
    setError(null);
    try {
      setDetail(
        decodeSkill(
          await execute(
            local ? "settings.local-catalog.localGet" : "settings.local-catalog.skill",
            { skillId: listing.id },
          ),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This skill could not be read.");
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the reviewed skill version from the host before installation.
  useEffect(() => {
    if (listing.id) void read();
  }, [listing.id, read]);
  const mutate = async (operation: OpenbotSettingsRequest["operation"], parameters: Json) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      await execute(operation, parameters);
      await refreshSkills();
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "The skill could not be changed.");
    }
    lock.current = false;
    setBusy(false);
  };
  const install = async () => {
    if (!detail || lock.current || !selected.length) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      for (const agentId of selected)
        await execute(
          local ? "settings.local-catalog.localInstall" : "settings.skills-admin.install",
          {
            agentId,
            skillId: detail.id,
            ...(local ? { revision: detail.version } : { versionId: detail.versionId }),
          },
        );
      await refreshSkills();
      setChoose(false);
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "The skill could not be added.");
      await settlePromise(() => refreshSkills());
    }
    lock.current = false;
    setBusy(false);
  };
  return (
    <div className="marketplace-view">
      <div className="integration-page marketplace-skill-page">
        <DetailHeader
          name={listing.name}
          logo={<SkillMark url={listing.iconUrl} />}
          verified={listing.verified}
          subtitle={listing.description}
          status={have.length ? "connected" : "idle"}
          statusLabel={
            have.length ? `On ${have.map((agent) => agent.name).join(", ")}` : "Not added"
          }
          actions={
            <>
              <SourceButton
                disabled={!detail || !model.onDraftRequest || have.length === 0}
                onClick={() => {
                  if (detail)
                    model.onDraftRequest?.({
                      title: `Try ${detail.name}`,
                      text: `${serializeBotReference("skill", detail.name, detail.id)} ${detail.examplePrompt?.trim() || "Help me use this skill."}`,
                      agentIds: have.map((agent) => agent.id),
                    });
                }}
              >
                Try skill
              </SourceButton>
              <SourceButton
                disabled={
                  !detail ||
                  busy ||
                  !model.agents.some((agent) => {
                    const next = request(
                      local
                        ? "settings.local-catalog.localInstall"
                        : "settings.skills-admin.install",
                      {
                        agentId: agent.id,
                        skillId: listing.id,
                        ...(local
                          ? { revision: detail?.version }
                          : { versionId: detail?.versionId }),
                      },
                    );
                    return next !== null && model.actions.can(next);
                  })
                }
                onClick={() => {
                  setSelected([]);
                  setChoose(true);
                }}
              >
                <Plus aria-hidden="true" />
                Add to agents
              </SourceButton>
            </>
          }
        />
        {error && (
          <p role="alert">
            {error}
            <SourceButton onClick={() => void read()}>Retry</SourceButton>
          </p>
        )}
        {!detail && !error && <p role="status">Loading skill details…</p>}
        {have.length > 0 && (
          <SettingsSection title={`Agents · ${have.length}`}>
            <SettingsCard>
              {have.map((agent) => {
                const skill = installed[agent.id]?.find((item) => item.skillId === listing.id);
                if (!skill) return null;
                const toggle = request("settings.skills-admin.setEnabled", {
                  agentId: agent.id,
                  skillId: listing.id,
                  enabled: skill.enabled === false,
                });
                const remove = request("settings.skills-admin.uninstall", {
                  agentId: agent.id,
                  skillId: listing.id,
                });
                return (
                  <SettingsRow
                    key={agent.id}
                    title={agent.name}
                    description={
                      skill.problem ??
                      (skill.state === "installed"
                        ? `Version ${skill.installedVersion}`
                        : skill.state)
                    }
                  >
                    {detail && skill.installedVersion < detail.version && (
                      <SourceButton
                        disabled={
                          busy || skill.state === "modified" || skill.state === "needs-repair"
                        }
                        onClick={() =>
                          void mutate(
                            local
                              ? "settings.local-catalog.localInstall"
                              : "settings.skills-admin.install",
                            {
                              agentId: agent.id,
                              skillId: detail.id,
                              ...(local
                                ? { revision: detail.version }
                                : { versionId: detail.versionId }),
                            },
                          )
                        }
                      >
                        Update
                      </SourceButton>
                    )}
                    <SourceSwitch
                      label={`Enable ${listing.name} for ${agent.name}`}
                      checked={skill.enabled !== false}
                      disabled={
                        busy ||
                        skill.state === "modified" ||
                        skill.state === "needs-repair" ||
                        !toggle ||
                        !model.actions.can(toggle)
                      }
                      onChange={(checked) =>
                        void mutate("settings.skills-admin.setEnabled", {
                          agentId: agent.id,
                          skillId: listing.id,
                          enabled: checked,
                        })
                      }
                    />
                    {(skill.origin === undefined ||
                      skill.origin === "marketplace" ||
                      skill.origin === "local") && (
                      <SourceButton
                        variant="destructive-ghost"
                        disabled={busy || !remove || !model.actions.can(remove)}
                        onClick={() =>
                          void confirmed(
                            `Remove ${listing.name} from ${agent.name}${skill.state === "modified" ? ", including its locally modified copy" : ""}?`,
                          ).then((ok) => {
                            if (ok)
                              void mutate("settings.skills-admin.uninstall", {
                                agentId: agent.id,
                                skillId: listing.id,
                                ...(skill.state === "modified" ? { removeModified: true } : {}),
                              });
                          })
                        }
                      >
                        Remove
                      </SourceButton>
                    )}
                  </SettingsRow>
                );
              })}
            </SettingsCard>
          </SettingsSection>
        )}
        {detail && (
          <SettingsSection title="Instructions">
            <SettingsCard>
              <div className="integration-card-body marketplace-skill-instructions">
                <ReactMarkdown>{detail.instructions}</ReactMarkdown>
              </div>
            </SettingsCard>
          </SettingsSection>
        )}
        <Information
          description={listing.description}
          facts={[
            { label: "Creator", value: listing.creatorName },
            {
              label: "Source",
              value: model.capabilities.includes("sled-public-catalog-v1")
                ? "Public OpenBot catalog"
                : listing.verified
                  ? "Verified by OpenBot"
                  : "Public",
            },
            { label: "Category", value: CATEGORY_LABELS[listing.category] },
            { label: "Version", value: listing.version },
            {
              label: model.capabilities.includes("sled-public-catalog-v1") ? "Bundled" : "Updated",
              value: new Date(listing.updatedAt).toLocaleDateString(),
            },
            ...(model.capabilities.includes("sled-public-catalog-v1")
              ? []
              : [{ label: "Installs", value: listing.installs.toLocaleString() }]),
          ]}
        />
        <Dialog
          open={choose}
          onOpenChange={(value) => {
            if (!busy) setChoose(value);
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Add {listing.name} to agents</DialogTitle>
              <DialogDescription>
                Choose the agents that will receive this reviewed skill version.
              </DialogDescription>
            </DialogHeader>
            <div className="openbot-react">
              <SettingsCard>
                {model.agents
                  .filter((agent) => !have.some((current) => current.id === agent.id))
                  .map((agent) => (
                    <SettingsRow key={agent.id} title={agent.name}>
                      <input
                        type="checkbox"
                        aria-label={agent.name}
                        checked={selected.includes(agent.id)}
                        disabled={busy || installed[agent.id] === undefined}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, agent.id]
                              : current.filter((id) => id !== agent.id),
                          )
                        }
                      />
                    </SettingsRow>
                  ))}
              </SettingsCard>
              {error && <p role="alert">{error}</p>}
              <SourceButton disabled={busy} onClick={() => setChoose(false)}>
                Cancel
              </SourceButton>
              <SourceButton disabled={busy || !selected.length} onClick={() => void install()}>
                {busy ? "Adding…" : "Save"}
              </SourceButton>
            </div>
          </DialogPopup>
        </Dialog>
      </div>
    </div>
  );
}
