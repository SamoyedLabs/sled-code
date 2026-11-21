/* oxlint-disable shadcn/no-unknown-classes -- Source MarketplaceAppPage PluginAppPage layout. */
import { useState } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SkillGradient } from "../marketplace/SkillGradient";
import { ArrowRight, Copy, ExternalLink } from "lucide-react";
import { DetailHeader, Information, SkillMark } from "../marketplace/MarketplaceParts";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SourceButton,
} from "../settings/SettingsParts";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import type { MarketplacePluginDetail } from "./plugin-model";
import type { MarketplaceApp } from "../marketplace/marketplace-model";
import { T, useGT } from "gt-react";
export type AppConnection = {
  id: string;
  name: string;
  enabled: boolean;
  needsSignIn: boolean;
  account: boolean;
};
export function PluginAppPage(props: {
  plugin: MarketplacePluginDetail;
  status: MarketplaceApp["status"];
  connections: Readonly<Record<string, readonly AppConnection[]>>;
  canManage: boolean;
  error: string | null;
  onConnect: (appId?: string, mcpServerId?: string) => Promise<void>;
  onRemove: (ids: readonly string[]) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
  canAddAccount: boolean;
  onAddAccount: (appId: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onPrompt?: ((prompt: string) => void) | undefined;
}) {
  const gt = useGT();
  const p = props.plugin;
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [copied, setCopied] = useState(false),
    [rename, setRename] = useState<{ id: string; name: string } | null>(null),
    [removeAccount, setRemoveAccount] = useState<string | null>(null);
  const rows = p.apps.flatMap((app) => props.connections[app.id] ?? []);
  const link = (url: string | null, label: string) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {label}
        <ExternalLink size={12} />
      </a>
    ) : null;
  return (
    <div className="integration-page marketplace-plugin-page">
      <DetailHeader
        name={p.name}
        logo={<SkillMark url={p.iconUrl} size="lg" />}
        subtitle={p.tagline}
        status={props.status}
        statusLabel={
          {
            connected: "Connected",
            attention: "Needs attention",
            connecting: "Connecting",
            idle: "Not connected",
          }[props.status]
        }
        actions={
          <>
            <SourceButton
              variant="ghost"
              aria-label={gt("Copy link")}
              onClick={() =>
                void navigator.clipboard
                  .writeText(p.shareUrl)
                  .then(() => setCopied(true))
                  .catch(() => setError(gt("Could not copy the link.")))
              }
            >
              <Copy />
              {copied ? gt("Copied") : gt("Copy link")}
            </SourceButton>
            {props.status !== "connected" && (
              <SourceButton
                variant="default"
                disabled={!props.canManage}
                onClick={() => void props.onConnect()}
              >
                <T>Connect</T>
              </SourceButton>
            )}
          </>
        }
      />
      {props.error && (
        <div className="ui-alert" data-tone="warning" role="alert">
          <p>{props.error}</p>
          <SourceButton onClick={() => void props.onRefresh()}>
            <T>Retry</T>
          </SourceButton>
        </div>
      )}
      {p.prompts.length > 0 && (
        <div className="marketplace-try">
          <div className="skill-preview-card marketplace-try-card">
            <SkillGradient name={p.name} />
            {p.prompts.map((prompt) => (
              <div className="skill-preview-request" key={prompt.id}>
                <p>
                  <span className="reference-chip skill-preview-chip" data-kind="plugin">
                    <span className="reference-chip-icon">
                      <SkillMark url={p.iconUrl} />
                    </span>
                    {p.name}
                  </span>{" "}
                  {prompt.text}
                </p>
                <SourceButton
                  variant="ghost"
                  className="ui-icon-button"
                  aria-label={gt("Ask {name}: {text}", { name: p.name, text: prompt.text })}
                  disabled={!props.onPrompt || props.status !== "connected"}
                  onClick={() => props.onPrompt?.(prompt.text)}
                >
                  <ArrowRight />
                </SourceButton>
              </div>
            ))}
          </div>
        </div>
      )}
      <Information
        description={p.description}
        facts={[
          { label: gt("Developer"), value: p.creatorName },
          { label: gt("Category"), value: p.category },
          { label: gt("Version"), value: p.version },
          { label: gt("Website"), value: link(p.websiteUrl, "Website") },
          { label: gt("Privacy"), value: link(p.privacyPolicyUrl, "Privacy policy") },
          { label: gt("Terms"), value: link(p.termsUrl, "Terms of service") },
        ].filter((f) => f.value !== null)}
      />
      <SettingsSection
        title={gt("Connection")}
        actions={
          props.canAddAccount
            ? p.apps
                .filter(
                  (app) =>
                    app.server.transport === "http" &&
                    app.server.auth?.[0]?.kind === "link" &&
                    (props.connections[app.id]?.length ?? 0) > 0,
                )
                .map((app) => (
                  <SourceButton
                    key={app.id}
                    disabled={!props.canManage || busy}
                    onClick={() => void props.onAddAccount(app.id)}
                  >
                    <T>Add account</T>
                  </SourceButton>
                ))
            : null
        }
      >
        <SettingsCard>
          {p.apps.map((app) => {
            const connections = props.connections[app.id] ?? [];
            return connections.length ? (
              connections.map((row) => (
                <SettingsRow
                  key={row.id}
                  title={row.name}
                  description={
                    row.needsSignIn
                      ? gt("Sign in again to restore access")
                      : row.enabled
                        ? gt("Connected")
                        : gt("Disabled")
                  }
                >
                  {row.account && (
                    <SourceButton
                      disabled={!props.canManage || busy}
                      variant="ghost"
                      onClick={() => setRename({ id: row.id, name: row.name })}
                    >
                      <T>Rename</T>
                    </SourceButton>
                  )}
                  {connections.length > 1 && (
                    <SourceButton
                      disabled={!props.canManage || busy}
                      variant="ghost"
                      onClick={() => setRemoveAccount(row.id)}
                    >
                      <T>Remove account</T>
                    </SourceButton>
                  )}
                  <SourceButton
                    disabled={!props.canManage || busy}
                    variant="ghost"
                    onClick={() => void props.onConnect(app.id, row.id)}
                  >
                    <T>Reconnect</T>
                  </SourceButton>
                  <SourceButton
                    disabled={!props.canManage || busy}
                    variant="ghost"
                    onClick={() => {
                      setBusy(true);
                      void props
                        .onToggle(row.id, !row.enabled)
                        .catch((cause) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : gt("Could not update connection."),
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    {row.enabled ? gt("Disable") : gt("Enable")}
                  </SourceButton>
                </SettingsRow>
              ))
            ) : (
              <SettingsRow key={app.id} title={app.name} description={app.description}>
                <SourceButton
                  disabled={!props.canManage}
                  onClick={() => void props.onConnect(app.id)}
                >
                  <T>Connect</T>
                </SourceButton>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      </SettingsSection>
      {error && <p role="alert">{error}</p>}
      <SourceConfirmDialog
        open={rename !== null}
        tone="default"
        title={gt("Rename account")}
        description={gt("Use this name to refer to the account in messages.")}
        confirmLabel={gt("Save")}
        pending={busy}
        error={error}
        onCancel={() => setRename(null)}
        onConfirm={async () => {
          if (!rename?.name.trim()) return;
          setBusy(true);
          const settled = await settlePromise(async () => {
            await props.onRename(rename.id, rename.name);
            setRename(null);
          });
          if (settled._tag === "Failure") {
            const cause = squashAtomCommandFailure(settled);
            setError(cause instanceof Error ? cause.message : gt("Could not rename account."));
          }
          setBusy(false);
        }}
      >
        <label className="ui-field">
          <span className="ui-label">
            <T>Name</T>
          </span>
          <input
            className="ui-input"
            maxLength={80}
            value={rename?.name ?? ""}
            onChange={(event) => {
              if (rename) setRename({ ...rename, name: event.target.value });
            }}
          />
        </label>
      </SourceConfirmDialog>
      <SourceConfirmDialog
        open={removeAccount !== null}
        title={gt("Remove account?")}
        description={gt("Agents will no longer have access to this account.")}
        confirmLabel={gt("Remove account")}
        pending={busy}
        error={error}
        onCancel={() => setRemoveAccount(null)}
        onConfirm={async () => {
          if (!removeAccount) return;
          setBusy(true);
          const settled = await settlePromise(async () => {
            await props.onRemove([removeAccount]);
            setRemoveAccount(null);
          });
          if (settled._tag === "Failure") {
            const cause = squashAtomCommandFailure(settled);
            setError(cause instanceof Error ? cause.message : gt("Could not remove account."));
          }
          setBusy(false);
        }}
      />

      {rows.length > 0 && (
        <SettingsSection title={gt("Danger zone")}>
          <SettingsCard>
            <SettingsRow
              title={gt("Disconnect {name}", { name: p.name })}
              description={gt(
                "Remove this app’s connections from the host. Agents will no longer have access.",
              )}
            >
              <SourceButton
                variant="destructive-ghost"
                disabled={!props.canManage}
                onClick={() => setConfirm(true)}
              >
                <T>Disconnect</T>
              </SourceButton>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}
      <SourceConfirmDialog
        open={confirm}
        title={gt("Disconnect {name}?", { name: p.name })}
        description={gt("This removes the app connections from the host.")}
        confirmLabel={gt("Disconnect")}
        pending={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          const settled = await settlePromise(async () => {
            await props.onRemove(rows.map((row) => row.id));
            setConfirm(false);
          });
          if (settled._tag === "Failure") {
            const cause = squashAtomCommandFailure(settled);
            setError(cause instanceof Error ? cause.message : gt("Could not disconnect."));
          }
          setBusy(false);
        }}
      />
    </div>
  );
}
