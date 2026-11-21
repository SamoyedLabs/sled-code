/* oxlint-disable shadcn/no-unknown-classes -- Exact source VaultPanel list, menus and mounted tab contents. */
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  ChevronDown,
  Copy,
  CreditCard,
  Ellipsis,
  KeyRound,
  KeySquare,
  Pencil,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import type { OpenbotVaultSave, OpenbotVaultState } from "@t3tools/contracts";
import { SettingsSection, SettingsSearch, SourceButton } from "../settings/SettingsParts";
import { MenuPopup } from "../OpenbotMenu";
import { OpenbotSlidingTabs } from "../OpenbotSlidingTabs";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { VaultItemDialog, type VaultSecretRequest } from "./VaultItemDialog";
import { VaultArtwork } from "./VaultArtwork";
import {
  BRAND_NAME,
  FILTERS,
  KIND_LABEL,
  NEW_TITLE,
  SECRET_TEXT,
  itemMatches,
  vaultExpiryText,
  type VaultItemKind,
  type VaultItemSummary,
  type VaultContactSummary,
  type VaultSecretField,
} from "./vault-model";
import { t } from "./text";
import "./Vault.css";
import "../provider/AgentUsage.css";
export interface VaultPanelProps {
  state: OpenbotVaultState;
  apiKeys: boolean;
  busy?: boolean;
  error?: string | null;
  notice?: string | null;
  onSave: (input: OpenbotVaultSave) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReveal: (request: VaultSecretRequest) => Promise<string>;
  onCopy: (request: VaultSecretRequest) => Promise<void>;
  onCopyText: (value: string) => Promise<void>;
  onImportCsv?: (() => Promise<{ imported: number; skipped: number } | null>) | undefined;
  onReset: () => Promise<void>;
  canSave?: boolean;
  canDelete?: boolean;
  canReveal?: boolean;
  canReset?: boolean;
}
export function VaultPanel(props: VaultPanelProps) {
  const [filter, setFilter] = useState<VaultItemKind | "all">("all"),
    [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{
      kind: VaultItemKind;
      item: VaultItemSummary | null;
    } | null>(null),
    [deleting, setDeleting] = useState<VaultItemSummary | null>(null),
    [importing, setImporting] = useState(false),
    [resetting, setResetting] = useState(false),
    [failure, setFailure] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const filters = FILTERS.filter((item) => item.value !== "apiKey" || props.apiKeys);
  const countryName = (country: string) =>
    country ? (new Intl.DisplayNames(undefined, { type: "region" }).of(country) ?? country) : "";
  const contactLine = (item: VaultContactSummary) =>
    [item.address, item.city, item.postalCode, countryName(item.country)]
      .filter(Boolean)
      .join(", ");
  const itemTitle = (item: VaultItemSummary) =>
    item.kind === "login"
      ? item.website || t("vault.untitledLogin")
      : item.kind === "card"
        ? item.label ||
          t("vault.maskedCard", {
            brand: item.brand ? BRAND_NAME[item.brand] : t("vault.kind.card"),
            last4: item.last4,
          })
        : item.kind === "apiKey"
          ? item.name
          : item.label || item.fullName || t("vault.untitledContact");
  const itemDetail = (item: VaultItemSummary) =>
    item.kind === "login"
      ? item.username || t("vault.noUsername")
      : item.kind === "card"
        ? t("vault.cardSummary", {
            last4: item.last4,
            expiry: vaultExpiryText(item.expMonth, item.expYear),
          })
        : item.kind === "apiKey"
          ? item.notes || t("vault.kind.apiKey")
          : contactLine(item) || item.email || item.phone;
  const close = () => {
    setEditing(null);
    setDeleting(null);
    setImporting(false);
    setResetting(false);
    setFailure(null);
  };
  const run = async (action: () => Promise<void>) => {
    setFailure(null);
    setNotice(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : t("vault.failed"));
      return false;
    }
  };
  const openEdit = (kind: VaultItemKind, item: VaultItemSummary | null) => {
    setFailure(null);
    setNotice(null);
    setEditing({ kind, item });
  };
  return (
    <div className="vault-panel">
      {props.state.status !== "ready" && (
        <div className="ui-alert" data-tone="warning">
          <span className="ui-alert-icon">
            <ShieldCheck />
          </span>
          <div className="ui-alert-content">
            <div className="ui-alert-title">
              {t(
                props.state.status === "unavailable"
                  ? "vault.unavailableTitle"
                  : "vault.unreadableTitle",
              )}
            </div>
            <p className="ui-alert-description">
              {t(
                props.state.status === "unavailable"
                  ? "vault.unavailableDescription"
                  : "vault.unreadableDescription",
              )}
            </p>
          </div>
          {props.state.status === "unreadable" && props.canReset !== false && (
            <div className="ui-alert-actions">
              <SourceButton
                onClick={() => {
                  setFailure(null);
                  setResetting(true);
                }}
              >
                {t("vault.reset")}
              </SourceButton>
            </div>
          )}
        </div>
      )}
      {props.state.status === "ready" && (
        <SettingsSection
          title={t("vault.items.title")}
          description={t("vault.items.description")}
          actions={
            props.canSave !== false && (
              <Menu.Root>
                <Menu.Trigger
                  className="ui-button ui-button-variant-default ui-button-size-sm"
                  disabled={props.busy}
                >
                  {t("vault.newItem")}
                  <ChevronDown aria-hidden="true" />
                </Menu.Trigger>
                <MenuPopup align="end">
                  {filters
                    .flatMap((item) => (item.value === "all" ? [] : [item.value]))
                    .map((kind) => (
                      <Menu.Item
                        key={kind}
                        className="ui-action-menu-item"
                        onClick={() => openEdit(kind, null)}
                      >
                        <KindIcon kind={kind} />
                        {t(KIND_LABEL[kind])}
                      </Menu.Item>
                    ))}
                  {props.onImportCsv && (
                    <>
                      <Menu.Separator className="ui-action-menu-separator" />
                      <Menu.Item
                        className="ui-action-menu-item"
                        onClick={() => {
                          setFailure(null);
                          setNotice(null);
                          setImporting(true);
                        }}
                      >
                        <Upload aria-hidden="true" />
                        {t("vault.importMenu")}
                      </Menu.Item>
                    </>
                  )}
                </MenuPopup>
              </Menu.Root>
            )
          }
        >
          <div className="vault-toolbar">
            <OpenbotSlidingTabs
              value={filter}
              onChange={setFilter}
              label={t("vault.filter.label")}
              items={filters.map((item) => ({
                value: item.value,
                label: (
                  <>
                    {t(item.label)}{" "}
                    <span className="vault-count">
                      {
                        props.state.items.filter(
                          (row) => item.value === "all" || row.kind === item.value,
                        ).length
                      }
                    </span>
                  </>
                ),
              }))}
            />
            {props.state.items.length > 0 && (
              <SettingsSearch
                type="search"
                label={t("vault.search")}
                value={query}
                onChange={setQuery}
              />
            )}
          </div>
          {(notice || props.notice) && (
            <p className="ui-text" data-variant="caption" data-tone="muted" role="status">
              {notice || props.notice}
            </p>
          )}
          {!editing && !deleting && !importing && (failure || props.error) && (
            <p className="ui-text" data-tone="danger" data-variant="caption" role="alert">
              {failure || props.error}
            </p>
          )}
          <div className="ui-sliding-tabs-content-slot">
            {filters.map((tab) => {
              const visible = props.state.items.filter(
                (item) =>
                  (tab.value === "all" || item.kind === tab.value) && itemMatches(item, query),
              );
              return (
                <div
                  key={tab.value}
                  role="tabpanel"
                  className="ui-sliding-tabs-content"
                  inert={filter !== tab.value}
                  aria-hidden={filter !== tab.value}
                  data-selected={filter === tab.value ? "" : undefined}
                >
                  <div
                    className="ui-item-group settings-modal-card"
                    data-surface="subtle"
                    aria-label={t(tab.label)}
                  >
                    {!visible.length ? (
                      <div className="ui-item server-settings-empty-row">
                        <div className="ui-item-content">
                          <div className="ui-item-description">
                            {!props.state.items.length
                              ? t("vault.empty")
                              : query
                                ? t("vault.noMatch", { query })
                                : t(tab.empty)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      visible.map((item) => (
                        <div
                          key={item.id}
                          className="ui-item settings-modal-row integrations-hub-row"
                        >
                          <SourceButton
                            variant="ghost"
                            className="integrations-hub-hitarea"
                            aria-label={t("vault.edit", { name: itemTitle(item) })}
                            disabled={props.canSave === false}
                            onClick={() => openEdit(item.kind, item)}
                          />
                          <div className="ui-item-media">
                            <VaultArtwork item={item} />
                          </div>
                          <div className="ui-item-content">
                            <div className="ui-item-title vault-truncate">{itemTitle(item)}</div>
                            <div className="ui-item-description vault-truncate">
                              {[
                                itemDetail(item),
                                item.addedBy ? t("vault.addedBy", { agent: item.addedBy }) : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          <div className="ui-item-actions integrations-hub-actions">
                            <ItemMenu
                              item={item}
                              title={itemTitle(item)}
                              address={item.kind === "contact" ? contactLine(item) : ""}
                              canSave={props.canSave !== false}
                              canDelete={props.canDelete !== false}
                              canReveal={props.canReveal !== false}
                              onEdit={() => openEdit(item.kind, item)}
                              onDelete={() => {
                                setFailure(null);
                                setNotice(null);
                                setDeleting(item);
                              }}
                              onCopySecret={(field) => {
                                void run(() => props.onCopy({ id: item.id, field }));
                              }}
                              onCopyText={(value) => {
                                void run(() => props.onCopyText(value));
                              }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SettingsSection>
      )}
      {editing && (
        <VaultItemDialog
          key={editing.item?.id ?? editing.kind}
          kind={editing.kind}
          item={editing.item}
          contacts={props.state.items.filter(
            (item): item is VaultContactSummary => item.kind === "contact",
          )}
          title={editing.item ? itemTitle(editing.item) : t(NEW_TITLE[editing.kind])}
          onSave={props.onSave}
          onReveal={props.onReveal}
          onClose={close}
        />
      )}
      <SourceConfirmDialog
        open={deleting !== null}
        title={t("vault.deleteTitle", { name: deleting ? itemTitle(deleting) : "" })}
        description={t("vault.deleteDescription")}
        confirmLabel={t("common.delete")}
        error={failure}
        onCancel={close}
        onConfirm={async () => {
          if (deleting && (await run(() => props.onDelete(deleting.id)))) close();
        }}
      />
      <SourceConfirmDialog
        open={importing}
        tone="default"
        icon={<Upload />}
        title={t("vault.importTitle")}
        description={t("vault.importDescription")}
        confirmLabel={t("vault.importChoose")}
        error={failure}
        onCancel={close}
        onConfirm={async () => {
          await run(async () => {
            const result = await props.onImportCsv?.();
            if (result) {
              close();
              setNotice(
                t("vault.importDone", {
                  imported: String(result.imported),
                  skipped: String(result.skipped),
                }),
              );
            }
          });
        }}
      />
      <SourceConfirmDialog
        open={resetting}
        title={t("vault.resetTitle")}
        description={t("vault.resetDescription")}
        confirmLabel={t("vault.reset")}
        error={failure}
        onCancel={close}
        onConfirm={async () => {
          if (await run(props.onReset)) close();
        }}
      />
    </div>
  );
}
function KindIcon({ kind }: { kind: VaultItemKind }) {
  return (
    <span className="vault-icon" aria-hidden="true">
      {kind === "login" ? (
        <KeyRound />
      ) : kind === "card" ? (
        <CreditCard />
      ) : kind === "contact" ? (
        <UserRound />
      ) : (
        <KeySquare />
      )}
    </span>
  );
}
function ItemMenu(props: {
  item: VaultItemSummary;
  title: string;
  address: string;
  canSave: boolean;
  canDelete: boolean;
  canReveal: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCopySecret: (field: VaultSecretField) => void;
  onCopyText: (value: string) => void;
}) {
  const item = props.item;
  const secrets: VaultSecretField[] =
    item.kind === "login"
      ? item.hasPassword
        ? ["password"]
        : []
      : item.kind === "apiKey"
        ? item.hasKey
          ? ["key"]
          : []
        : item.kind === "card"
          ? ["number", "securityCode"]
          : [];
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className="ui-button ui-button-variant-ghost ui-button-size-icon-sm ui-icon-button"
        aria-label={t("vault.actionsFor", { name: props.title })}
      >
        <Ellipsis aria-hidden="true" />
      </Menu.Trigger>
      <MenuPopup align="end">
        {props.canSave && (
          <Menu.Item className="ui-action-menu-item" onClick={props.onEdit}>
            <Pencil aria-hidden="true" />
            {t("common.edit")}
          </Menu.Item>
        )}
        {item.kind === "login" && item.username && (
          <Menu.Item
            className="ui-action-menu-item"
            onClick={() => props.onCopyText(item.username)}
          >
            <Copy aria-hidden="true" />
            {t("vault.copyUsername")}
          </Menu.Item>
        )}
        {item.kind === "apiKey" && (
          <Menu.Item className="ui-action-menu-item" onClick={() => props.onCopyText(item.name)}>
            <Copy aria-hidden="true" />
            {t("vault.copyVariableName")}
          </Menu.Item>
        )}
        {props.canReveal &&
          secrets.map((field) => (
            <Menu.Item
              key={field}
              className="ui-action-menu-item"
              onClick={() => props.onCopySecret(field)}
            >
              <Copy aria-hidden="true" />
              {t(SECRET_TEXT[field].copy)}
            </Menu.Item>
          ))}
        {props.address && (
          <Menu.Item
            className="ui-action-menu-item"
            onClick={() => props.onCopyText(props.address)}
          >
            <Copy aria-hidden="true" />
            {t("vault.copyAddress")}
          </Menu.Item>
        )}
        {props.canDelete && (
          <>
            <Menu.Separator className="ui-action-menu-separator" />
            <Menu.Item
              className="ui-action-menu-item ui-action-menu-danger"
              onClick={props.onDelete}
            >
              <Trash2 aria-hidden="true" />
              {t("common.delete")}
            </Menu.Item>
          </>
        )}
      </MenuPopup>
    </Menu.Root>
  );
}
