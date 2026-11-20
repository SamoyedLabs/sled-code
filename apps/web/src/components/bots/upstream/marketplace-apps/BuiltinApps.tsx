import { DiscordAccess } from "./DiscordAccess";
/* oxlint-disable shadcn/no-unknown-classes -- Source GitHubConnectorPanel, ChannelPage/ChannelParts and Slack/Telegram panels. */
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import {
  botConnectionAgents,
  botConnectionUrl,
  botMessagingGrant,
  botMessagingOrchestrator,
  botMessagingOrchestratorRequest,
  type BotMessagingPlatform,
} from "@t3tools/client-runtime/openbot/presentation";
import { Copy, ExternalLink, Lock, Check } from "lucide-react";
import { useBotConnections } from "../../../settings/useBotConnections";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import { DetailHeader } from "../marketplace/MarketplaceParts";
import type { MarketplaceApp } from "../marketplace/marketplace-model";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SourceButton,
} from "../settings/SettingsParts";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { t } from "../vault/connector-text";
import { GitHubMark, SlackMark, DiscordMark, TelegramMark, WhatsAppMark } from "./BrandMarks";
import type { McpExecute } from "./SourceMcpRelay";
import "./github-connector.css";
import "./slack-integration.css";
import "./integration-layout.css";
type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
  execute: McpExecute;
  allowed: boolean;
  revision: unknown;
};
type Controller = ReturnType<typeof useBotConnections>;
function useController(execute: McpExecute) {
  return useBotConnections(async (request) => {
    try {
      return { ok: true, value: await execute(request) };
    } catch (cause) {
      return {
        ok: false,
        error: cause instanceof Error ? cause.message : "Could not update the connection.",
      };
    }
  });
}
function Link({ url, children }: { url: string | null | undefined; children: ReactNode }) {
  const safe = botConnectionUrl(url ?? null);
  return safe ? (
    <a
      className="ui-button ui-button-variant-outline ui-button-size-sm"
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ExternalLink size={14} />
    </a>
  ) : null;
}
function Failure({ error, retry }: { error: string | null; retry: () => void }) {
  return error ? (
    <div className="ui-alert" data-tone="warning" role="alert">
      <div className="ui-alert-content">
        <p className="ui-alert-description">{error}</p>
      </div>
      <div className="ui-alert-actions">
        <SourceButton onClick={retry}>Retry</SourceButton>
      </div>
    </div>
  ) : null;
}
export function Wizard({
  title,
  description,
  children,
  close,
  busy = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Viewport className="integration-dialog-backdrop">
            <Dialog.Popup className="integration-wizard-dialog">
              <div className="integration-wizard">
                <header className="integration-wizard-head">
                  <Dialog.Title>{title}</Dialog.Title>
                  <Dialog.Description>{description}</Dialog.Description>
                </header>
                <div className="integration-wizard-body">{children}</div>
                <footer className="integration-wizard-foot">
                  <SourceButton variant="ghost" disabled={busy} onClick={close}>
                    Close
                  </SourceButton>
                </footer>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Stepper({ labels, current }: { labels: readonly string[]; current: number }) {
  return (
    <ol className="integration-stepper">
      {labels.map((label, index) => (
        <li
          key={label}
          className="integration-step"
          data-state={index < current ? "done" : index === current ? "current" : "next"}
        >
          <span className="integration-step-index">{index < current ? <Check /> : index + 1}</span>
          <span className="marketplace-visually-hidden">{label}</span>
        </li>
      ))}
    </ol>
  );
}
function useGithub(props: Props) {
  const c = useController(props.execute),
    [dialog, setDialog] = useState(false),
    [confirm, setConfirm] = useState(false);
  const refresh = async () => {
    await c.run([
      { operation: "connector.github.status" },
      { operation: "connector.github.repositories" },
    ]);
  };
  const read = useEffectEvent(refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the host's current GitHub state; no sign-in starts on mount.
  useEffect(() => {
    void props.revision;
    if (props.allowed) void read();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A configuration notification invalidates this external host read.
  }, [props.allowed, props.revision]);
  const pending = c.state.github?.state === "pending",
    poll = useEffectEvent(async () => {
      await c.run([{ operation: "connector.github.status" }]);
    });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A pending host device sign-in needs status reads until it ends.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void poll(), 1500);
    return () => clearInterval(timer);
  }, [pending]);
  const connect = async () => {
    setDialog(true);
    await c.run([{ operation: "connector.github.connect" }]);
  };
  const close = async () => {
    if (c.busy) return;
    if (
      c.state.github?.state === "pending" &&
      !(await c.run([{ operation: "connector.github.cancel" }]))
    )
      return;
    setDialog(false);
    await refresh();
  };
  const state = c.state.github,
    status: MarketplaceApp["status"] =
      !state || c.error
        ? "attention"
        : state.state === "pending"
          ? "connecting"
          : state.state === "expired"
            ? "attention"
            : state.state === "connected"
              ? "connected"
              : "idle";
  const app: MarketplaceApp = {
    id: "github",
    name: "GitHub",
    tagline: "Repositories, issues and pull requests",
    category: "coding",
    icon: <GitHubMark />,
    status,
    ...(props.allowed && state?.available && state.state !== "connected" ? { connect } : {}),
    detail: (
      <GithubPage
        c={c}
        hostName={props.hostName}
        allowed={props.allowed}
        status={status}
        connect={connect}
        refresh={refresh}
        disconnect={() => setConfirm(true)}
      />
    ),
  };
  const overlay = (
    <>
      {(dialog || pending) && (
        <Wizard
          title={t("connector.github.connect")}
          description={t("connector.github.pendingDescription")}
          busy={c.busy}
          close={() => void close()}
        >
          <Stepper
            labels={[t("connector.github.stepSignIn"), t("connector.github.stepConnected")]}
            current={state?.state === "connected" ? 1 : 0}
          />
          {state?.state === "connected" ? (
            <div className="integration-card-body">
              <GitHubMark />
              <h4>{t("connector.github.connectedAs", { login: state.login ?? "" })}</h4>
              <Link url={state.installUrl}>{t("connector.github.chooseRepositories")}</Link>
            </div>
          ) : (
            <div className="github-connector-connect">
              {state?.userCode ? (
                <>
                  <p>{t("connector.github.pendingTitle")}</p>
                  <output className="github-connector-code" aria-label={state.userCode}>
                    {Array.from(state.userCode, (character, index) => (
                      <span
                        className="github-connector-code-char"
                        data-separator={character === "-" ? "true" : undefined}
                        key={`${index}:${character}`}
                      >
                        {character}
                      </span>
                    ))}
                  </output>
                  <SourceButton
                    aria-label="Copy code"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(state.userCode ?? "")
                        .catch(() => c.setError("Could not copy the code."))
                    }
                  >
                    <Copy />
                  </SourceButton>
                  <Link url={state.verificationUri}>{t("connector.github.openGitHub")}</Link>
                  <p role="status">{t("connector.github.waiting")}</p>
                </>
              ) : (
                <p role="status">
                  {c.busy
                    ? "Requesting a code…"
                    : (state?.error ?? c.error ?? "Sign-in has ended.")}
                </p>
              )}
            </div>
          )}
          <Failure error={c.error} retry={() => void connect()} />
        </Wizard>
      )}
      <SourceConfirmDialog
        open={confirm}
        title={t("connector.github.disconnectTitle")}
        description={t("connector.github.disconnectSummary")}
        confirmLabel={t("connector.github.disconnect")}
        pending={c.busy}
        error={c.error}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          if (await c.run([{ operation: "connector.github.disconnect" }])) setConfirm(false);
        }}
      />
    </>
  );
  return { app, overlay };
}
function GithubPage({
  c,
  hostName,
  allowed,
  status,
  connect,
  refresh,
  disconnect,
}: {
  c: Controller;
  hostName: string;
  allowed: boolean;
  status: MarketplaceApp["status"];
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  disconnect: () => void;
}) {
  const [query, setQuery] = useState("");
  const state = c.state.github,
    rows = c.state.repositories?.repositories.filter((row) =>
      row.fullName.toLowerCase().includes(query.trim().toLowerCase()),
    );
  return (
    <div className="integration-page github-connector">
      <DetailHeader
        name="GitHub"
        logo={<GitHubMark />}
        subtitle={t("connector.github.descriptionHost", { host: hostName })}
        status={state && !state.available ? "unavailable" : status}
        statusLabel={
          !state
            ? "Loading connection…"
            : !state.available
              ? "Unavailable"
              : status === "connected"
                ? "Connected"
                : status === "connecting"
                  ? "Connecting"
                  : status === "attention"
                    ? "Needs attention"
                    : "Not connected"
        }
        actions={
          allowed && state?.available && state.state !== "connected" ? (
            <SourceButton variant="default" disabled={c.busy} onClick={() => void connect()}>
              {state.state === "expired" ? "Reconnect" : "Connect GitHub"}
            </SourceButton>
          ) : null
        }
      />
      <Failure
        error={!allowed ? "You do not have permission to manage this connection." : c.error}
        retry={() => void refresh()}
      />
      {state && !state.available && (
        <p className="integration-card-note">This host has no GitHub App configured.</p>
      )}
      {state?.state === "expired" && (
        <div className="ui-alert" data-tone="warning">
          <strong>{t("connector.github.expiredTitle")}</strong>
          <p>{t("connector.github.expiredDescription", { login: state.login ?? "" })}</p>
        </div>
      )}
      {(state?.state === "connected" || state?.state === "expired") && (
        <SettingsSection title={t("connector.github.accountTitle")}>
          <SettingsCard>
            <SettingsRow title={`@${state.login ?? ""}`} />
          </SettingsCard>
        </SettingsSection>
      )}
      {state?.state === "connected" && (
        <SettingsSection
          title={t("connector.github.repositoriesTitle")}
          description={t("connector.github.repositoriesDescription")}
          actions={<Link url={state.installUrl}>{t("connector.github.chooseRepositories")}</Link>}
        >
          <SettingsCard>
            <div className="integration-card-body">
              <input
                className="ui-input"
                type="search"
                aria-label="Filter repositories"
                placeholder={`Filter ${c.state.repositories?.total ?? 0} repositories`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {!rows ? (
              <p className="integration-card-note">Reading repositories…</p>
            ) : rows.length ? (
              rows.map((row) => (
                <SettingsRow key={row.fullName} title={row.fullName}>
                  {row.private && (
                    <span className="z-badge">
                      <Lock size={12} />
                      Private
                    </span>
                  )}
                </SettingsRow>
              ))
            ) : (
              <p className="integration-card-note">
                {query ? `No repository matches “${query}”.` : t("connector.github.noRepositories")}
              </p>
            )}
          </SettingsCard>
        </SettingsSection>
      )}
      {state && (state.state === "connected" || state.state === "expired") && (
        <SettingsSection title="Danger zone">
          <SettingsCard>
            <SettingsRow
              title={t("connector.github.disconnectTitle")}
              description={t("connector.github.disconnectSummary")}
            >
              <SourceButton
                variant="destructive-ghost"
                disabled={!allowed || c.busy}
                onClick={disconnect}
              >
                {t("connector.github.disconnect")}
              </SourceButton>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  );
}
const NAMES = { slack: "Slack", discord: "Discord", telegram: "Telegram" };
const MARKS = { slack: SlackMark, discord: DiscordMark, telegram: TelegramMark };
function useMessaging(props: Props, platform: BotMessagingPlatform) {
  const c = useController(props.execute),
    [dialog, setDialog] = useState(false),
    [callback, setCallback] = useState(""),
    [removing, setRemoving] = useState<readonly string[] | null>(null);
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, request: { operation: "agent.list" } },
    }),
  );
  const agents = botConnectionAgents(query.data),
    rows = c.state.messaging[platform]?.connections ?? null;
  const name = NAMES[platform],
    Mark = MARKS[platform];
  const refresh = async () => {
    await c.run([{ operation: "connector.messaging.overview", platform }]);
  };
  const read = useEffectEvent(refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the host's actual channel connections on first permitted mount.
  useEffect(() => {
    void props.revision;
    if (props.allowed) void read();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A configuration notification invalidates this external host read.
  }, [props.allowed, props.revision]);
  const poll = useEffectEvent(refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The explicitly opened connect wizard follows host-side completion.
  useEffect(() => {
    if (!dialog) return;
    const timer = setInterval(() => void poll(), 2000);
    return () => clearInterval(timer);
  }, [dialog]);
  const page = c.state.page?.platform === platform ? c.state.page : null;
  const assignments =
    rows?.map((row) => ({
      row,
      agent: agents ? botMessagingOrchestrator(platform, row.workspaceId, rows, agents) : null,
    })) ?? [];
  const missing = assignments.find((entry) => !entry.agent),
    attention = assignments.filter(
      (entry) => !["connected", "paused"].includes(entry.row.state) || !entry.agent,
    ).length;
  const status: MarketplaceApp["status"] =
    !rows || c.error || attention ? "attention" : rows.length ? "connected" : "idle";
  const prefix = `connector.${platform}`;
  const connect = async () => {
    setDialog(true);
    setCallback("");
    if (platform !== "telegram")
      await c.run([{ operation: "connector.messaging.connect", platform, place: "group" }]);
  };
  const addAgent = async () => {
    if (!missing) return;
    const request = botMessagingOrchestratorRequest(platform, missing.row.workspaceId);
    if (
      request &&
      (await c.run([request, { operation: "connector.messaging.overview", platform }]))
    )
      query.refresh();
  };
  const toggle = async (id: string, enabled: boolean) => {
    await c.run([
      { operation: "connector.messaging.enabled", platform, workspaceId: id, enabled },
      { operation: "connector.messaging.overview", platform },
    ]);
  };
  const reconnect = async (id: string) => {
    if (await c.run([{ operation: "connector.messaging.reconnect", platform, workspaceId: id }]))
      setDialog(true);
  };
  const app: MarketplaceApp = {
    id: platform,
    name,
    tagline:
      platform === "slack"
        ? "Mentions and direct messages in Slack"
        : platform === "discord"
          ? "Mentions and direct messages in Discord"
          : "Groups and direct chats in Telegram",
    category: "productivity",
    icon: <Mark />,
    status,
    ...(props.allowed && rows ? { connect } : {}),
    detail: (
      <div className="integration-page channel-page">
        <DetailHeader
          name={name}
          logo={<Mark />}
          subtitle={t(`${prefix}.description`)}
          status={status}
          statusLabel={
            !rows
              ? "Connection unknown"
              : status === "attention"
                ? "Needs attention"
                : status === "connected"
                  ? "Connected"
                  : "Not connected"
          }
          actions={
            rows && props.allowed ? (
              <SourceButton variant="default" disabled={c.busy} onClick={() => void connect()}>
                {t(`${prefix}.connect`)}
              </SourceButton>
            ) : null
          }
        />
        <Failure
          error={!props.allowed ? "You do not have permission to manage this connection." : c.error}
          retry={() => void refresh()}
        />
        {attention > 0 && (
          <div className="ui-alert" data-tone="warning">
            <strong>{t(`${prefix}.attentionTitle`, { count: attention })}</strong>
            <p>{t(`${prefix}.attentionDescription`)}</p>
          </div>
        )}
        {rows && rows.length > 0 && (
          <>
            <SettingsSection
              title={
                platform === "telegram"
                  ? "Chats"
                  : platform === "discord"
                    ? "Servers"
                    : "Workspaces"
              }
              actions={
                <SourceButton disabled={!props.allowed || c.busy} onClick={() => void connect()}>
                  {platform === "telegram"
                    ? "Add chat"
                    : platform === "discord"
                      ? "Add server"
                      : "Add workspace"}
                </SourceButton>
              }
            >
              <SettingsCard>
                {rows.map((row) => (
                  <SettingsRow
                    key={row.workspaceId}
                    title={row.workspaceName}
                    description={
                      row.missingScopes.length
                        ? `Missing permissions: ${row.missingScopes.join(", ")}`
                        : row.retryAt
                          ? `Retry at ${new Date(row.retryAt).toLocaleTimeString()}`
                          : platform === "telegram"
                            ? row.workspaceId.startsWith("-")
                              ? t("connector.telegram.groupDescription")
                              : t("connector.telegram.directDescription")
                            : row.state
                    }
                  >
                    <SourceButton
                      disabled={!props.allowed || c.busy}
                      onClick={() => void toggle(row.workspaceId, !row.enabled)}
                    >
                      {row.enabled ? "Pause" : "Resume"}
                    </SourceButton>
                    {!["connected", "paused"].includes(row.state) && (
                      <SourceButton
                        disabled={!props.allowed || c.busy}
                        onClick={() => void reconnect(row.workspaceId)}
                      >
                        Reconnect
                      </SourceButton>
                    )}
                    <SourceButton
                      variant="ghost"
                      disabled={!props.allowed || c.busy}
                      onClick={() => setRemoving([row.workspaceId])}
                    >
                      Disconnect
                    </SourceButton>
                  </SettingsRow>
                ))}
              </SettingsCard>
            </SettingsSection>
            <SettingsSection
              title={t(`${prefix}.orchestratorTitle`)}
              description={t(`${prefix}.orchestratorDescription`)}
            >
              <SettingsCard>
                {assignments
                  .filter(
                    (entry, index, list) =>
                      entry.agent &&
                      list.findIndex((other) => other.agent?.id === entry.agent?.id) === index,
                  )
                  .map((entry) => (
                    <SettingsRow
                      key={entry.agent!.id}
                      title={entry.agent!.name}
                      description={`${name} Orchestrator`}
                    />
                  ))}
                {missing && (
                  <SettingsRow
                    title={t(`${prefix}.orchestratorNone`)}
                    description={t(`${prefix}.orchestratorNoneDescription`)}
                  >
                    <SourceButton
                      disabled={!props.allowed || c.busy || !agents}
                      onClick={() => void addAgent()}
                    >
                      {t(`${prefix}.addAgent`)}
                    </SourceButton>
                  </SettingsRow>
                )}
                <p className="integration-card-note">
                  {platform === "slack"
                    ? t("connector.slack.inviteNote")
                    : platform === "telegram"
                      ? t("connector.telegram.mentionNote")
                      : t("connector.discord.channelsNote")}
                </p>
              </SettingsCard>
            </SettingsSection>
            {platform === "discord" && (
              <DiscordAccess
                environmentId={props.environmentId}
                hostId={props.hostId}
                hostName={props.hostName}
                connections={rows}
                execute={props.execute}
              />
            )}
            <SettingsSection title="Danger zone">
              <SettingsCard>
                <SettingsRow
                  title={t(`${prefix}.disconnectAllTitle`)}
                  description="Disconnecting removes every linked place. An orchestrator used by no remaining place is also deleted."
                >
                  <SourceButton
                    variant="destructive-ghost"
                    disabled={!props.allowed || c.busy}
                    onClick={() => setRemoving(rows.map((row) => row.workspaceId))}
                  >
                    Disconnect
                  </SourceButton>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>
          </>
        )}
      </div>
    ),
  };
  const complete = async () => {
    if (!page?.nonce || platform === "telegram") return;
    const request = botMessagingGrant(platform, callback, page.nonce);
    if (!request) {
      c.setError("Paste the return link for this pending connection.");
      return;
    }
    setCallback("");
    await c.run([request, { operation: "connector.messaging.overview", platform }]);
  };
  const overlay = (
    <>
      {dialog && (
        <Wizard
          title={t(`${prefix}.connect`)}
          description={t(`${prefix}.description`)}
          close={() => setDialog(false)}
          busy={c.busy}
        >
          <Stepper
            labels={[
              platform === "telegram" ? "Chat" : platform === "discord" ? "Server" : "Workspace",
              "Orchestrator",
            ]}
            current={rows?.length ? 1 : 0}
          />
          {platform === "telegram" && !page && (
            <div className="telegram-connect-places">
              <SourceButton
                disabled={c.busy}
                onClick={() =>
                  void c.run([
                    { operation: "connector.messaging.connect", platform, place: "group" },
                  ])
                }
              >
                Connect group chat
              </SourceButton>
              <SourceButton
                disabled={c.busy}
                onClick={() =>
                  void c.run([
                    { operation: "connector.messaging.connect", platform, place: "direct" },
                  ])
                }
              >
                Connect direct chat
              </SourceButton>
            </div>
          )}
          {page && (
            <>
              <ol className="channel-checklist">
                <li>Open {name}.</li>
                <li>
                  {platform === "telegram"
                    ? "Choose the chat and add OpenBot."
                    : "Allow OpenBot to join your workspace."}
                </li>
                <li>Return here to finish the connection.</li>
              </ol>
              <Link url={page.url}>Open {name}</Link>
              {page.nonce && platform !== "telegram" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void complete();
                  }}
                >
                  <label className="ui-field">
                    <span className="ui-label">Paste the OpenBot return link</span>
                    <input
                      className="ui-input"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={callback}
                      onChange={(event) => setCallback(event.target.value)}
                    />
                  </label>
                  <SourceButton type="submit" disabled={c.busy || !callback.trim()}>
                    Complete connection
                  </SourceButton>
                </form>
              )}
            </>
          )}
          {missing && (
            <div className="channel-orchestrator-card">
              <h4>{t(`${prefix}.orchestratorName`)}</h4>
              <p>{t(`${prefix}.orchestratorRole`)}</p>
              <ul>
                <li>{t(`${prefix}.orchestratorDoesReceive`)}</li>
                <li>{t(`${prefix}.orchestratorDoesDelegate`)}</li>
                <li>{t(`${prefix}.orchestratorDoesAnswer`)}</li>
              </ul>
              <SourceButton
                variant="default"
                disabled={c.busy || !agents}
                onClick={() => void addAgent()}
              >
                {t(`${prefix}.addAgent`)}
              </SourceButton>
            </div>
          )}
          <Failure error={c.error} retry={() => void refresh()} />
        </Wizard>
      )}
      <SourceConfirmDialog
        open={removing !== null}
        title={`Disconnect ${name}?`}
        description={`This removes the selected connections from ${props.hostName}. If no other linked place uses an orchestrator, that agent is also deleted. Active work may need to finish first.`}
        confirmLabel="Disconnect"
        pending={c.busy}
        error={c.error}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const requests: OpenbotAdminRequest[] = removing.map((workspaceId) => ({
            operation: "connector.messaging.disconnect",
            platform,
            workspaceId,
          }));
          if (await c.run([...requests, { operation: "connector.messaging.overview", platform }])) {
            setRemoving(null);
            query.refresh();
          }
        }}
      />
    </>
  );
  return { app, overlay };
}
export function useBuiltinApps(props: Props) {
  const github = useGithub(props),
    slack = useMessaging(props, "slack"),
    discord = useMessaging(props, "discord"),
    telegram = useMessaging(props, "telegram");
  const whatsapp: MarketplaceApp = {
    id: "whatsapp",
    name: "WhatsApp",
    tagline: "Your own chat and the people you allow in WhatsApp",
    category: "productivity",
    icon: <WhatsAppMark />,
    status: "attention",
    detail: (
      <div className="integration-page channel-page">
        <DetailHeader
          name="WhatsApp"
          logo={<WhatsAppMark />}
          status="unavailable"
          statusLabel="Unavailable on a joined host"
          subtitle={t("connector.whatsapp.description")}
        />
        <div className="ui-alert" data-tone="warning" role="status">
          <div className="ui-alert-content">
            <strong>Open WhatsApp settings on the host</strong>
            <p className="ui-alert-description">
              This host’s remote interface does not support linking WhatsApp numbers, scanning
              pairing codes, or managing allowed senders. Open OpenBot on {props.hostName} to manage
              this connection.
            </p>
          </div>
        </div>
      </div>
    ),
  };
  return {
    apps: [slack.app, discord.app, telegram.app, whatsapp, github.app],
    overlay: (
      <>
        {github.overlay}
        {slack.overlay}
        {discord.overlay}
        {telegram.overlay}
      </>
    ),
  };
}
