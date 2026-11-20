/* oxlint-disable shadcn/no-unknown-classes -- Source ItemDialog fields, secret visibility and dialog styling. */
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import type { OpenbotVaultSave } from "@t3tools/contracts";
import { SourceButton } from "../settings/SettingsParts";
import { VaultArtwork } from "./VaultArtwork";
import {
  draftOf,
  draftReady,
  saveInput,
  prefilled,
  SECRET_TEXT,
  VAULT_COUNTRY_CODES,
  type Draft,
  type VaultItemSummary,
  type VaultItemKind,
  type VaultSecretField,
  type VaultContactSummary,
} from "./vault-model";
import { t } from "./text";
import "./Vault.css";
import "../OpenbotSidebarDeleteDialog.css";
export type VaultSecretRequest = { id: string; field: VaultSecretField };
export function VaultItemDialog(props: {
  kind: VaultItemKind;
  item: VaultItemSummary | null;
  title: string;
  contacts: readonly VaultContactSummary[];
  onSave: (input: OpenbotVaultSave) => Promise<void>;
  onReveal: (request: VaultSecretRequest) => Promise<string>;
  onClose: () => void;
  prefill?: Readonly<Record<string, string>>;
  fromChat?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    prefilled(draftOf(props.kind, props.item), props.prefill ?? {}),
  );
  const [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const set = <T extends Draft>(current: T, patch: Partial<T>) =>
    setDraft({ ...current, ...patch });
  const reveal = (field: VaultSecretField) =>
    props.item ? props.onReveal({ id: props.item.id, field }) : Promise.resolve("");
  const saved = (field: VaultSecretField) =>
    field === "password"
      ? props.item?.kind === "login" && props.item.hasPassword
      : field === "key"
        ? props.item?.kind === "apiKey" && props.item.hasKey
        : props.item?.kind === "card";
  const secret = (
    field: VaultSecretField,
    value: string,
    onChange: (value: string) => void,
    maxLength: number,
    inputMode?: "numeric",
    placeholder?: string,
  ) => (
    <SecretInput
      field={field}
      label={t(`vault.field.${field === "key" ? "apiKey" : field}`)}
      value={value}
      onChange={onChange}
      saved={Boolean(saved(field))}
      onReveal={() => reveal(field)}
      onError={setError}
      maxLength={maxLength}
      inputMode={inputMode}
      placeholder={placeholder}
    />
  );
  const submit = async () => {
    if (lock.current || !draftReady(draft, props.item)) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await props.onSave(saveInput(draft, props.item?.id ?? null));
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("vault.failed"));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const countries = VAULT_COUNTRY_CODES.map((code) => ({
    code,
    name: new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const contactLine = (item: VaultContactSummary) =>
    [
      item.address,
      item.city,
      item.postalCode,
      item.country ? new Intl.DisplayNames(undefined, { type: "region" }).of(item.country) : "",
    ]
      .filter(Boolean)
      .join(", ");
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose();
      }}
    >
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Viewport className="ui-dialog-overlay ui-confirm-dialog-overlay">
            <Dialog.Popup className="ui-dialog-content ui-confirm-dialog vault-dialog">
              <form
                className="vault-dialog-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <header className="vault-dialog-header">
                  <VaultArtwork item={draft} saved={props.item} />
                  <Dialog.Title className="vault-dialog-title">{props.title}</Dialog.Title>
                  <SourceButton
                    variant="ghost"
                    aria-label={t("common.close")}
                    disabled={saving}
                    onClick={props.onClose}
                  >
                    <X />
                  </SourceButton>
                </header>
                <div className="vault-dialog-body">
                  <div className="vault-fields">
                    {draft.kind === "login" && (
                      <>
                        <TextField
                          wide
                          name="website"
                          value={draft.website}
                          onChange={(website) => set(draft, { website })}
                          placeholder={t("vault.placeholder.website")}
                        />
                        <TextField
                          wide
                          name="username"
                          value={draft.username}
                          onChange={(username) => set(draft, { username })}
                          placeholder={t("vault.placeholder.username")}
                        />
                        <VaultField wide label={t("vault.field.password")}>
                          {secret(
                            "password",
                            draft.password,
                            (password) => set(draft, { password }),
                            1024,
                          )}
                        </VaultField>
                        {!props.fromChat && (
                          <Notes value={draft.notes} onChange={(notes) => set(draft, { notes })} />
                        )}
                      </>
                    )}
                    {draft.kind === "card" && (
                      <>
                        <TextField
                          wide
                          name="label"
                          value={draft.label}
                          onChange={(label) => set(draft, { label })}
                          placeholder={t("vault.placeholder.cardLabel")}
                        />
                        <TextField
                          wide
                          name="nameOnCard"
                          value={draft.nameOnCard}
                          onChange={(nameOnCard) => set(draft, { nameOnCard })}
                        />
                        <VaultField wide label={t("vault.field.number")}>
                          {secret(
                            "number",
                            draft.number,
                            (number) => set(draft, { number }),
                            23,
                            "numeric",
                            "1234 5678 9012 3456",
                          )}
                        </VaultField>
                        <TextField
                          name="expiry"
                          maxLength={7}
                          inputMode="numeric"
                          placeholder={t("vault.placeholder.expiry")}
                          value={draft.expiry}
                          onChange={(expiry) => set(draft, { expiry })}
                        />
                        <VaultField label={t("vault.field.securityCode")}>
                          {secret(
                            "securityCode",
                            draft.securityCode,
                            (securityCode) => set(draft, { securityCode }),
                            4,
                            "numeric",
                          )}
                        </VaultField>
                        {!props.fromChat && (
                          <VaultField wide label={t("vault.field.billing")}>
                            <select
                              className="ui-native-select"
                              aria-label={t("vault.field.billing")}
                              value={draft.billingContactId}
                              onChange={(event) =>
                                set(draft, { billingContactId: event.target.value })
                              }
                            >
                              <option value="">{t("vault.billingNone")}</option>
                              {props.contacts.map((contact) => (
                                <option key={contact.id} value={contact.id}>
                                  {[contact.label || contact.fullName, contactLine(contact)]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </option>
                              ))}
                            </select>
                          </VaultField>
                        )}
                        {draft.fillSites.length > 0 && (
                          <fieldset className="vault-wide vault-fill-sites">
                            <legend className="ui-label">{t("vault.field.fillSites")}</legend>
                            <ul className="vault-sites">
                              {draft.fillSites.map((site) => (
                                <li className="vault-site" key={site}>
                                  <span className="vault-truncate">{site}</span>
                                  <SourceButton
                                    variant="ghost"
                                    aria-label={t("vault.removeSite", { site })}
                                    onClick={() =>
                                      set(draft, {
                                        fillSites: draft.fillSites.filter((kept) => kept !== site),
                                      })
                                    }
                                  >
                                    <X />
                                  </SourceButton>
                                </li>
                              ))}
                            </ul>
                          </fieldset>
                        )}
                      </>
                    )}
                    {draft.kind === "contact" && (
                      <>
                        {(
                          [
                            "label",
                            "fullName",
                            "address",
                            "address2",
                            "city",
                            "region",
                            "postalCode",
                          ] as const
                        ).map((name) => (
                          <TextField
                            key={name}
                            name={name}
                            wide={name === "address" || name === "address2"}
                            value={draft[name]}
                            onChange={(value) => set(draft, { [name]: value })}
                          />
                        ))}
                        <VaultField label={t("vault.field.country")}>
                          <select
                            className="ui-native-select"
                            aria-label={t("vault.field.country")}
                            value={draft.country}
                            onChange={(event) => set(draft, { country: event.target.value })}
                          >
                            <option value="">{t("vault.chooseCountry")}</option>
                            {countries.map((country) => (
                              <option key={country.code} value={country.code}>
                                {country.name}
                              </option>
                            ))}
                          </select>
                        </VaultField>
                        <TextField
                          name="phone"
                          type="tel"
                          value={draft.phone}
                          onChange={(phone) => set(draft, { phone })}
                        />
                        <TextField
                          name="email"
                          type="email"
                          value={draft.email}
                          onChange={(email) => set(draft, { email })}
                        />
                      </>
                    )}
                    {draft.kind === "apiKey" && (
                      <>
                        <VaultField
                          wide
                          label={t("vault.field.variableName")}
                          description={t("vault.variableNameHint")}
                        >
                          <input
                            className="ui-input"
                            aria-label={t("vault.field.variableName")}
                            placeholder={t("vault.placeholder.variableName")}
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={64}
                            value={draft.name}
                            onChange={(event) => {
                              const input = event.currentTarget,
                                { selectionStart, selectionEnd } = input;
                              input.value = input.value.toUpperCase();
                              input.setSelectionRange(selectionStart, selectionEnd);
                              set(draft, { name: input.value });
                            }}
                          />
                        </VaultField>
                        <VaultField wide label={t("vault.field.apiKey")}>
                          {secret("key", draft.key, (key) => set(draft, { key }), 8192)}
                        </VaultField>
                        <Notes value={draft.notes} onChange={(notes) => set(draft, { notes })} />
                      </>
                    )}
                  </div>
                  {error && (
                    <p className="ui-text" data-tone="danger" data-variant="caption" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                <footer className="ui-confirm-dialog-actions">
                  <SourceButton
                    size="default"
                    variant="ghost"
                    disabled={saving}
                    onClick={props.onClose}
                  >
                    {t("common.cancel")}
                  </SourceButton>
                  <SourceButton
                    type="submit"
                    size="default"
                    variant="default"
                    disabled={saving || !draftReady(draft, props.item)}
                  >
                    {t(saving ? "common.saving" : "common.save")}
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
export function VaultField({
  label,
  description,
  wide,
  children,
}: {
  label: string;
  description?: string;
  wide?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <label className={`ui-field${wide ? " vault-wide" : ""}`}>
      <span className="ui-label">{label}</span>
      {children}
      {description && <span className="ui-field-description">{description}</span>}
    </label>
  );
}
function TextField({
  name,
  value,
  onChange,
  wide,
  placeholder,
  maxLength = 512,
  type = "text",
  inputMode,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean | undefined;
  placeholder?: string;
  maxLength?: number;
  type?: string;
  inputMode?: "numeric";
}) {
  return (
    <VaultField wide={wide} label={t(`vault.field.${name}`)}>
      <input
        className="ui-input"
        aria-label={t(`vault.field.${name}`)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
      />
    </VaultField>
  );
}
function Notes({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <VaultField wide label={t("vault.field.notes")}>
      <textarea
        className="ui-textarea"
        rows={2}
        maxLength={4096}
        aria-label={t("vault.field.notes")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </VaultField>
  );
}
function SecretInput(props: {
  field: VaultSecretField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  saved: boolean;
  onReveal: () => Promise<string>;
  onError: (error: string) => void;
  maxLength: number;
  inputMode?: "numeric" | undefined;
  placeholder?: string | undefined;
}) {
  const [shown, setShown] = useState(false),
    [revealing, setRevealing] = useState(false);
  const active = useRef(true),
    generation = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Discard private reveal responses when the selected dialog or field unmounts.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, []);
  const toggle = async () => {
    if (shown) {
      setShown(false);
      return;
    }
    const requested = generation.current;
    if (props.saved && props.value === "") {
      setRevealing(true);
      try {
        const value = await props.onReveal();
        if (!active.current || requested !== generation.current) return;
        props.onChange(value);
      } catch (cause) {
        if (active.current)
          props.onError(cause instanceof Error ? cause.message : t("vault.revealFailed"));
        return;
      } finally {
        if (active.current) setRevealing(false);
      }
    }
    if (active.current) setShown(true);
  };
  return (
    <div className="vault-secret">
      <input
        className="ui-input"
        type={shown ? "text" : "password"}
        aria-label={props.label}
        autoComplete="off"
        spellCheck={false}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        placeholder={props.saved ? t("vault.placeholder.saved") : props.placeholder}
        value={props.value}
        onChange={(event) => {
          generation.current += 1;
          props.onChange(event.target.value);
        }}
      />
      <SourceButton
        variant="ghost"
        aria-label={t(shown ? SECRET_TEXT[props.field].hide : SECRET_TEXT[props.field].show)}
        disabled={revealing}
        onClick={() => void toggle()}
      >
        {shown ? <EyeOff /> : <Eye />}
      </SourceButton>
    </div>
  );
}
