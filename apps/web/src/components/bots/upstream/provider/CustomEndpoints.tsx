/* oxlint-disable shadcn/no-unknown-classes -- Source CustomEndpointsPage, CustomProviderDialog and RepeatableRows presentation. */
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Dialog } from "@base-ui/react/dialog";
import { SlidersHorizontal, Plus, Trash2, X } from "lucide-react";
import {
  customProviderEndpoints,
  providerAdminRequest,
} from "@t3tools/client-runtime/openbot/presentation";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SourceButton,
} from "../settings/SettingsParts";
import { DetailHeader } from "../marketplace/MarketplaceParts";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { useSourceScrollFades } from "../data/useSourceScrollFades";
import type { ProviderSettingsExecute } from "./SourceHostProviders";
import { isAgentProvider } from "./identity";
import { currentText } from "./text";
import "./CustomProvider.css";
import { useGT } from "gt-react";
const { t } = currentText();
type Endpoint = NonNullable<ReturnType<typeof customProviderEndpoints>>[number];
export function CustomEndpoints({
  execute,
  ready,
  onChange,
}: {
  execute: ProviderSettingsExecute;
  ready: boolean;
  onChange: () => void;
}) {
  const [endpoints, setEndpoints] = useState<readonly Endpoint[] | null>(null),
    [adding, setAdding] = useState(false),
    [removing, setRemoving] = useState<Endpoint | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const load = async () => {
    const list = customProviderEndpoints(await execute({ operation: "provider.custom.list" }));
    if (!list) throw new Error("Could not read custom providers.");
    return list;
  };
  const loadEvent = useEffectEvent(load);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the host endpoint summaries when this source detail opens; no response carries saved secrets.
  useEffect(() => {
    let active = true;
    void loadEvent().then(
      (list) => {
        if (active) setEndpoints(list);
      },
      (cause) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const changed = async () => {
    setEndpoints(await load());
    onChange();
  };
  return (
    <>
      <DetailHeader
        logo={<SlidersHorizontal className="provider-picker-custom-mark" />}
        name={t("provider.custom.name")}
        status={endpoints?.length ? "connected" : "idle"}
        statusLabel={
          endpoints?.length
            ? t("provider.endpointCount", { count: endpoints.length })
            : t("provider.status.notConnected")
        }
        subtitle={t("provider.custom.description")}
      />
      <SettingsSection
        title={t("provider.settings.endpoints")}
        actions={
          <SourceButton
            aria-label={t("provider.custom.addLabel")}
            disabled={!ready || busy}
            onClick={() => setAdding(true)}
          >
            <Plus />
            {t("common.add")}
          </SourceButton>
        }
      >
        <SettingsCard>
          {!endpoints?.length ? (
            <div className="ui-item server-settings-empty-row">
              <div className="ui-item-content">
                <div className="ui-item-description" role="status">
                  {endpoints ? t("provider.settings.noEndpoints") : t("common.loading")}
                </div>
              </div>
            </div>
          ) : (
            endpoints.map((endpoint) => (
              <SettingsRow
                key={endpoint.id}
                title={endpoint.name}
                description={`${t("provider.settings.endpointModels", { url: endpoint.baseUrl, count: endpoint.models.length })}${endpoint.hasApiKey ? ` · ${t("customProvider.list.apiKeySaved")}` : ""}`}
              >
                <SourceButton
                  variant="destructive-ghost"
                  aria-label={t("customProvider.list.deleteLabel", { name: endpoint.name })}
                  disabled={busy}
                  onClick={() => setRemoving(endpoint)}
                >
                  <Trash2 />
                  {t("common.remove")}
                </SourceButton>
              </SettingsRow>
            ))
          )}
        </SettingsCard>
        {error && (
          <p className="provider-settings-error" role="alert">
            {error}
          </p>
        )}
      </SettingsSection>
      <SourceConfirmDialog
        open={removing !== null}
        title={t("customProvider.list.confirmTitle", { name: removing?.name ?? "" })}
        description={t("customProvider.list.confirmDescription")}
        confirmLabel={t("common.remove")}
        pending={busy}
        error={error}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          setError(null);
          const settled = await settlePromise(async () => {
            await execute({ operation: "provider.custom.delete", id: removing.id });
            await changed();
            setRemoving(null);
          });
          if (settled._tag === "Failure") {
            setError(String(squashAtomCommandFailure(settled)));
          }
          setBusy(false);
        }}
      />
      {adding && (
        <CustomProviderDialog
          taken={endpoints?.map((e) => e.id) ?? []}
          onClose={() => setAdding(false)}
          onSave={async (input) => {
            await execute(input);
            await changed();
            setAdding(false);
          }}
        />
      )}
    </>
  );
}
type Row = { key: number; id: string; name: string };
export function CustomProviderDialog({
  taken,
  onClose,
  onSave,
}: {
  taken: readonly string[];
  onClose: () => void;
  onSave: (input: unknown) => Promise<void>;
}) {
  const gt = useGT();
  const [id, setId] = useState(""),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [models, setModels] = useState<Row[]>([{ key: 0, id: "", name: "" }]),
    [headers, setHeaders] = useState<Row[]>([{ key: 1, id: "", name: "" }]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [errors, setErrors] = useState<Record<string, string>>({});
  const nextKey = useRef(2),
    lock = useRef(false);
  const { scroll } = useSourceScrollFades();
  const submit = async () => {
    if (lock.current) return;
    const next: Record<string, string> = {};
    const providerId = id.trim();
    if (!providerId) next.id = t("customProvider.error.providerIdRequired");
    else if (!/^[a-z0-9][a-z0-9_-]*$/.test(providerId))
      next.id = t("customProvider.error.providerIdPattern");
    else if (isAgentProvider(providerId))
      next.id = t("customProvider.error.providerIdBuiltIn", { id: providerId });
    else if (taken.includes(providerId))
      next.id = t("customProvider.error.providerIdSaved", { id: providerId });
    if (!name.trim()) next.name = t("customProvider.error.displayNameRequired");
    try {
      const parsed = new URL(url.trim());
      if (!["http:", "https:"].includes(parsed.protocol))
        next.url = t("customProvider.error.baseUrlProtocol");
      else if (parsed.username || parsed.password)
        next.url = t("customProvider.error.baseUrlCredential");
    } catch {
      next.url = t(
        url.trim() ? "customProvider.error.baseUrlInvalid" : "customProvider.error.baseUrlRequired",
        { example: "http://127.0.0.1:11434/v1" },
      );
    }
    const filled = models.filter((r) => r.id.trim() || r.name.trim());
    if (!filled.length) next.models = t("customProvider.error.modelsRequired");
    const ids = new Set<string>();
    for (const row of filled) {
      const id = row.id.trim();
      if (!id) next[`model${row.key}`] = t("customProvider.error.modelIdRequired");
      else if (ids.has(id))
        next[`model${row.key}`] = t("customProvider.error.modelIdDuplicate", { id });
      else if (!/^[^\s\x00-\x1f]+$/.test(id))
        next[`model${row.key}`] = t("customProvider.error.modelIdInvalid");
      ids.add(id);
    }
    const names = new Set<string>();
    for (const row of headers.filter((r) => r.id.trim() || r.name.trim())) {
      const name = row.id.trim();
      if (!name) next[`header${row.key}`] = t("customProvider.error.headerNameRequired");
      else if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name))
        next[`header${row.key}`] = t("customProvider.error.headerNameInvalid");
      else if (names.has(name.toLowerCase()))
        next[`header${row.key}`] = t("customProvider.error.headerDuplicate", { name });
      else if (!row.name.trim())
        next[`header${row.key}`] = t("customProvider.error.headerValueRequired");
      names.add(name.toLowerCase());
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const request = providerAdminRequest({
      operation: "provider.custom.save",
      input: {
        id: providerId,
        name: name.trim(),
        baseUrl: url.trim(),
        apiKey: apiKey.trim() || null,
        models: filled.map((r) => ({ id: r.id.trim(), name: r.name.trim() || r.id.trim() })),
        headers: headers
          .filter((r) => r.id.trim() || r.name.trim())
          .map((r) => ({ name: r.id.trim(), value: r.name.trim() })),
      },
    });
    if (!request) {
      setError(t("customProvider.error.modelIdInvalid"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      await onSave(request);
      setApiKey("");
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    lock.current = false;
    setBusy(false);
  };
  const repeat = (kind: "model" | "header", rows: Row[], setRows: (rows: Row[]) => void) => (
    <section
      className="custom-provider-rows"
      aria-label={t(kind === "model" ? "customProvider.models" : "customProvider.headers")}
    >
      <div className="custom-provider-rows-heading">
        <span className="ui-text" data-variant="label-sm">
          {t(kind === "model" ? "customProvider.models" : "customProvider.headers")}
        </span>
        {kind === "model" && errors.models && (
          <span className="custom-provider-rows-error" role="alert">
            {errors.models}
          </span>
        )}
      </div>
      {rows.map((row, index) => (
        <div className="custom-provider-row" key={row.key}>
          <div className="custom-provider-row-inputs">
            <input
              className="ui-input"
              aria-label={t(`customProvider.${kind}.${kind === "model" ? "id" : "name"}`, {
                number: index + 1,
              })}
              placeholder={kind === "model" ? "model-id" : gt("Header-Name")}
              value={row.id}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              disabled={busy}
              onChange={(e) =>
                setRows(rows.map((r) => (r.key === row.key ? { ...r, id: e.target.value } : r)))
              }
            />
            <input
              className="ui-input"
              aria-label={t(`customProvider.${kind}.${kind === "model" ? "name" : "value"}`, {
                number: index + 1,
              })}
              placeholder={t(
                kind === "model"
                  ? "customProvider.model.namePlaceholder"
                  : "customProvider.header.valuePlaceholder",
              )}
              value={row.name}
              autoComplete="off"
              spellCheck={false}
              maxLength={kind === "model" ? 160 : 4096}
              disabled={busy}
              onChange={(e) =>
                setRows(rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))
              }
            />
            <SourceButton
              variant="ghost"
              className="ui-icon-button"
              aria-label={t(`customProvider.${kind}.remove`, { number: index + 1 })}
              disabled={busy || rows.length < 2}
              onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
            >
              <Trash2 />
            </SourceButton>
          </div>
          {errors[`${kind}${row.key}`] && (
            <span className="ui-text custom-provider-row-error" role="alert">
              {errors[`${kind}${row.key}`]}
            </span>
          )}
        </div>
      ))}
      <SourceButton
        variant="ghost"
        disabled={busy || rows.length >= (kind === "model" ? 64 : 32)}
        onClick={() => setRows([...rows, { key: nextKey.current++, id: "", name: "" }])}
      >
        <Plus />
        {t(`customProvider.${kind}.add`)}
      </SourceButton>
    </section>
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Viewport className="ui-dialog-overlay custom-provider-backdrop">
            <Dialog.Popup className="custom-provider-dialog" aria-busy={busy} render={<section />}>
              <Dialog.Title className="sr-only">{t("customProvider.form.title")}</Dialog.Title>
              <Dialog.Description className="sr-only">
                {t("customProvider.form.description")}
              </Dialog.Description>
              <header className="custom-provider-header">
                <span className="custom-provider-mark" aria-hidden="true">
                  <SlidersHorizontal />
                </span>
                <div className="custom-provider-title">
                  <h2 className="ui-heading" data-size="md">
                    {t("customProvider.form.heading")}
                  </h2>
                  <span className="ui-text" data-tone="muted" data-variant="caption">
                    {t("customProvider.form.subtitle")}
                  </span>
                </div>
                <SourceButton
                  variant="ghost"
                  className="custom-provider-close ui-icon-button"
                  aria-label={t("common.close")}
                  disabled={busy}
                  onClick={onClose}
                >
                  <X />
                </SourceButton>
              </header>
              <form
                className="custom-provider-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="custom-provider-form" ref={scroll}>
                  <CustomField
                    label={t("customProvider.field.providerId")}
                    description={t("customProvider.field.providerIdHint")}
                    error={errors.id}
                  >
                    <input
                      className="ui-input"
                      value={id}
                      onChange={(e) => setId(e.target.value)}
                      placeholder="my-provider"
                      maxLength={128}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                    />
                  </CustomField>
                  <CustomField label={t("customProvider.field.displayName")} error={errors.name}>
                    <input
                      className="ui-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("customProvider.field.displayNamePlaceholder")}
                      maxLength={80}
                      disabled={busy}
                    />
                  </CustomField>
                  <CustomField label={t("customProvider.field.baseUrl")} error={errors.url}>
                    <input
                      className="ui-input"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="http://127.0.0.1:11434/v1"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={2048}
                      disabled={busy}
                    />
                  </CustomField>
                  <CustomField
                    label={t("customProvider.field.apiKey")}
                    description={t("customProvider.field.apiKeyHint")}
                  >
                    <input
                      className="ui-input"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={4096}
                      disabled={busy}
                    />
                  </CustomField>
                  {repeat("model", models, setModels)}
                  {repeat("header", headers, setHeaders)}
                </div>
                <footer className="custom-provider-actions">
                  {error && (
                    <span className="custom-provider-submit-error" role="alert">
                      {error}
                    </span>
                  )}
                  <SourceButton type="submit" variant="default" disabled={busy}>
                    {t(busy ? "common.saving" : "customProvider.submit")}
                  </SourceButton>
                </footer>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function CustomField({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="ui-field">
      <span className="ui-label">{label}</span>
      {description && <span className="ui-field-description">{description}</span>}
      {children}
      {error && (
        <span className="ui-field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
