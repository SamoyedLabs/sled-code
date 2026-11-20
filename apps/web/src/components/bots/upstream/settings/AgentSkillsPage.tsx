/* oxlint-disable shadcn/no-unknown-classes -- Original AgentSkillsModal rows and SkillPreview selectors are supplied by source CSS. */
import { useState } from "react";
import * as Schema from "effect/Schema";
import ReactMarkdown from "react-markdown";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, Puzzle, Trash2 } from "lucide-react";
import { InstalledSkill, decodeSkill, type SkillDetail } from "../marketplace/marketplace-model";
import { removableSkill } from "../marketplace/marketplace-library";
import { SkillGradient } from "../marketplace/SkillGradient";
import { MenuPopup } from "../OpenbotMenu";
import { confirmed } from "../../../settings/BotConnectionControls";
import { useAgentSettingsValue, type AgentSettingsApi } from "./agent-settings-api";
import { SettingsReadState } from "./AgentConfigurationPages";
import { SettingsPanelContent, SettingsPanelHeader } from "./SettingsPanel";
import { SourceButton } from "./SettingsParts";
import { SourceSwitch } from "./SourceSwitch";
import "./agent-skill-preview.css";
const decodeInstalled = Schema.decodeUnknownSync(Schema.Array(InstalledSkill));
export function AgentSkillsPage({
  api,
  onBack,
  onClose,
}: {
  api: AgentSettingsApi;
  onBack: () => void;
  onClose: () => void;
}) {
  const c = useAgentSettingsValue(
    async () => decodeInstalled(await api.setting("settings.skills-admin.list")),
    api.agentId,
  );
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const update = async (skill: InstalledSkill) => {
    if (skill.state === "modified" && !(await confirmed(`Replace your changes to ${skill.name}?`)))
      return;
    const next = decodeSkill(
      await api.setting(
        skill.origin === "local"
          ? "settings.local-catalog.localGet"
          : "settings.local-catalog.skill",
        { skillId: skill.skillId },
      ),
    );
    await api.setting(
      skill.origin === "local"
        ? "settings.local-catalog.localInstall"
        : "settings.skills-admin.install",
      {
        agentId: api.agentId,
        skillId: skill.skillId,
        ...(skill.origin === "local" ? { revision: next.version } : { versionId: next.versionId }),
        ...(skill.origin !== "local" && skill.state === "modified"
          ? { replaceModified: true }
          : {}),
      },
    );
  };
  const open = async (skill: InstalledSkill) => {
    await c.change(async () =>
      setDetail(
        decodeSkill(
          await api.setting(
            skill.origin === "local"
              ? "settings.local-catalog.localGet"
              : "settings.local-catalog.skill",
            { skillId: skill.skillId },
          ),
        ),
      ),
    );
  };
  return (
    <div className="agent-memories-view">
      <SettingsPanelHeader
        title={detail ? detail.name : "Skills"}
        onBack={() => (detail ? setDetail(null) : onBack())}
        onClose={onClose}
      />
      <SettingsPanelContent>
        <div className="agent-memories-page">
          <SettingsReadState
            busy={c.busy && !c.value}
            error={c.error}
            onRetry={() => void c.refresh()}
          />
          {detail ? (
            <section className="skill-preview">
              <header className="skill-preview-heading">
                <span className="agent-skill-icon" aria-hidden="true">
                  {detail.iconUrl ? <img src={detail.iconUrl} alt="" /> : <Puzzle />}
                </span>
                <div className="skill-preview-name">
                  <h2>{detail.name}</h2>
                  <p className="skill-preview-creator">By {detail.creatorName}</p>
                </div>
                <p className="skill-preview-summary">{detail.description}</p>
              </header>
              <div className="skill-preview-card">
                <SkillGradient name={detail.name} />
                <div className="skill-preview-request">
                  <p>{detail.examplePrompt ?? detail.description}</p>
                </div>
              </div>
              <div className="skill-preview-description message-markdown">
                <ReactMarkdown>{detail.instructions}</ReactMarkdown>
              </div>
            </section>
          ) : (
            c.value && (
              <div className="agent-memory-list agent-skill-rows">
                {c.value.length === 0 ? (
                  <p className="agent-memories-empty">No skills yet.</p>
                ) : (
                  c.value.map((skill) => (
                    <div
                      key={skill.skillId}
                      className={`agent-skill-row${skill.enabled === false ? " agent-skill-row-disabled" : ""}`}
                    >
                      <SourceButton
                        variant="ghost"
                        className="agent-skill-open"
                        disabled={c.busy || !api.capabilities.includes("local-skill-catalog-v1")}
                        onClick={() => void open(skill)}
                      >
                        <span className="agent-skill-icon">
                          <Puzzle aria-hidden="true" />
                        </span>
                        <div className="agent-skill-copy">
                          <div className="agent-skill-title">
                            <strong>{skill.name}</strong>
                          </div>
                          <small>
                            {skill.problem ??
                              skill.description ??
                              `Version ${skill.installedVersion}`}
                          </small>
                        </div>
                      </SourceButton>
                      {removableSkill(skill) && (
                        <>
                          {skill.state === "update-available" && (
                            <SourceButton
                              variant="ghost"
                              className="agent-skill-update"
                              disabled={c.busy}
                              onClick={() => void c.change(() => update(skill))}
                            >
                              Update
                            </SourceButton>
                          )}
                          <Menu.Root>
                            <Menu.Trigger
                              className="ui-button ui-button-variant-ghost ui-button-size-icon-sm"
                              aria-label={`Actions for ${skill.name}`}
                              disabled={c.busy}
                            >
                              <Ellipsis aria-hidden="true" />
                            </Menu.Trigger>
                            <MenuPopup align="end">
                              <Menu.Item
                                className="ui-action-menu-danger"
                                onClick={() =>
                                  void c.change(async () => {
                                    if (
                                      await confirmed(
                                        `Remove ${skill.name}${skill.state === "modified" ? " and its local changes" : ""}?`,
                                      )
                                    )
                                      await api.setting("settings.skills-admin.uninstall", {
                                        agentId: api.agentId,
                                        skillId: skill.skillId,
                                        ...(skill.state === "modified"
                                          ? { removeModified: true }
                                          : {}),
                                      });
                                  })
                                }
                              >
                                <Trash2 aria-hidden="true" />
                                Remove
                              </Menu.Item>
                            </MenuPopup>
                          </Menu.Root>
                          <SourceSwitch
                            label={`Enable ${skill.name}`}
                            checked={skill.enabled !== false}
                            disabled={
                              c.busy || skill.state === "modified" || skill.state === "needs-repair"
                            }
                            onChange={(enabled) =>
                              void c.change(() =>
                                api.setting("settings.skills-admin.setEnabled", {
                                  agentId: api.agentId,
                                  skillId: skill.skillId,
                                  enabled,
                                }),
                              )
                            }
                          />
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            )
          )}
        </div>
      </SettingsPanelContent>
    </div>
  );
}
