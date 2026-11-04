// @effect-diagnostics globalDate:off -- Keep the released calendar-date validator semantics.
// Copyright 2026 Synthetify Labs spółka z ograniczoną odpowiedzialnością.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Adapted from OpenBot v0.60.0, 0c7753fa622c38419939cd230657f40e5883d098.
const INPUT_LIMITS = { identifier: 128, accountName: 120 };
const VAULT_CARD_BRANDS = ["visa", "mastercard", "amex", "discover"] as const;
type VaultCardBrand = (typeof VAULT_CARD_BRANDS)[number];
const VAULT_TEXT_LIMIT = 512;
type ConversationMessageSender = { id: string; name: string };
type DynamicRecord = Record<string, unknown>;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isDynamicRecord = (v: unknown): v is DynamicRecord =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isOneOf = <T extends string | number>(values: readonly T[], v: unknown): v is T =>
  values.some((x) => x === v);
const isBoundedString = (v: unknown, max: number): v is string => isString(v) && v.length <= max;
const isIdentifier = (v: unknown): v is string =>
  isBoundedString(v, INPUT_LIMITS.identifier) && v.length > 0;

/** The version of `ConversationUiBlock`. A reader rejects any other. */
export const UI_BLOCK_VERSION = 1;

export const UI_BLOCK_LIMITS = {
  /** The spec as `JSON.stringify` writes it, in UTF-16 code units. */
  specJson: 64_000,
  /** A response as `JSON.stringify` writes it, in UTF-16 code units. */
  responseJson: 16_000,
  id: 64,
  title: 200,
  label: 120,
  meta: 60,
  text: 2_000,
  preview: 8_000,
  /** A text the person types: a form field, a free-text reply. */
  fieldValue: 8_000,
  outcome: 300,
  actions: 4,
  quickReplies: 8,
  choiceOptions: 20,
  confirmFields: 8,
  formFields: 20,
  selectOptions: 50,
  segmentedOptions: 6,
  holdMinMs: 400,
  holdMaxMs: 3_000,
  timestamp: 160,
} as const;

/** Letters, digits, `_ . : -`; 1 to 64 characters. See `isUiBlockId` for the reserved ids. */
export const UI_BLOCK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;

/** `actionId` of the submit button of a `choice` or a `form`. */
export const UI_BLOCK_SUBMIT_ACTION_ID = "submit";

export const UI_BLOCK_TEXT_ACTION_ID = "_text";
/** The key of the selected option ids in a `choice` response's `values`. */
export const UI_CHOICE_VALUES_KEY = "selected";
/** The fallback question id that carries the chosen action of a `confirm`. */
export const UI_CONFIRM_ACTION_QUESTION_ID = "action";
/** The fallback question id of a `quick_replies`. */
export const UI_QUICK_REPLIES_QUESTION_ID = "reply";
/** The fallback question id of a `choice`. */
export const UI_CHOICE_QUESTION_ID = "choice";

// Keys the legacy message read renames (`legacy-conversation-message.ts`). An id that becomes a record
// key in a response must not be one of them.
const LEGACY_KEY_IDS: ReadonlySet<string> = new Set([
  "botId",
  "recipientBotId",
  "recipientBotIds",
  "senderBotId",
]);

/** The look of a button. Only these; an agent cannot style a block any other way. */
export type UiActionStyle = "primary" | "secondary" | "ghost" | "danger";
export const UI_ACTION_STYLES = [
  "primary",
  "secondary",
  "ghost",
  "danger",
] as const satisfies readonly UiActionStyle[];

export interface UiAction {
  id: string;
  label: string;
  /** Absent means `secondary`. */
  style?: UiActionStyle;
  confirm?: boolean;
}

/** A read-only line of a `confirm`, such as "To: someone@example.com". */
export interface UiConfirmValueField {
  label: string;
  value: string;
}

/**
 * A choice inside a `confirm`, such as the sender address. The chosen option is the response value
 * under the key `select`; the first option is the default.
 */
export interface UiConfirmSelectField {
  label: string;
  select: string;
  options: string[];
}

export type UiConfirmField = UiConfirmValueField | UiConfirmSelectField;

/** Blocking. "Do this?" with the details and up to four buttons. */
export interface UiConfirmBlock {
  type: "confirm";
  title: string;
  /** Draws the block as dangerous. Its `primary` and `danger` buttons are held to press. */
  danger?: boolean;
  /** How long a held button is held, in ms, within `holdMinMs`..`holdMaxMs`. */
  confirmHold?: number;
  fields?: UiConfirmField[];
  /** A preview of what will happen, such as the body of a letter. Safe Markdown. */
  preview?: string;
  actions: UiAction[];
}

export interface UiOption {
  id: string;
  label: string;
}

/** Blocking. A row of reply chips. */
export interface UiQuickRepliesBlock {
  type: "quick_replies";
  title?: string;
  options: UiOption[];
  /** Shows a text box beside the chips. A typed reply is valid either way (`UI_BLOCK_TEXT_ACTION_ID`). */
  allowText?: boolean;
}

export interface UiChoiceOption extends UiOption {
  /** A short note on the right, such as a count. */
  meta?: string;
  /** Selected when the block opens. At most one unless `multiple`. */
  selected?: boolean;
}

/** Blocking. A list to pick one option from, or several with `multiple`. */
export interface UiChoiceBlock {
  type: "choice";
  title: string;
  multiple?: boolean;
  options: UiChoiceOption[];
  /** The submit button label. */
  submit?: string;
}

export interface UiFormTextField {
  id: string;
  kind: "text" | "textarea";
  label: string;
  required?: boolean;
  placeholder?: string;
  value?: string;

  secret?: boolean;
}

export interface UiFormOptionsField {
  id: string;
  kind: "select" | "segmented";
  label?: string;
  options: string[];
  required?: boolean;
  /** One of `options`. */
  value?: string;
}

export interface UiFormDateField {
  id: string;
  kind: "date";
  label: string;
  required?: boolean;
  /** `YYYY-MM-DD`. */
  value?: string;
}

export type UiFormField = UiFormTextField | UiFormOptionsField | UiFormDateField;
export type UiFormFieldKind = UiFormField["kind"];

/** Blocking. A small form; every value is a string (a date is `YYYY-MM-DD`). */
export interface UiFormBlock {
  type: "form";
  title: string;
  fields: UiFormField[];
  /** The submit button label. */
  submit?: string;
}

export type UiBlockSpec = UiConfirmBlock | UiQuickRepliesBlock | UiChoiceBlock | UiFormBlock;
export type UiBlockType = UiBlockSpec["type"];

export const UI_BLOCK_TYPES = [
  "confirm",
  "quick_replies",
  "choice",
  "form",
] as const satisfies readonly UiBlockType[];

export type UiBlockValue = string | string[];

export interface UiBlockResponse {
  actionId: string;
  values?: Record<string, UiBlockValue>;
  /** An answer in words, with `UI_BLOCK_TEXT_ACTION_ID`. */
  text?: string;
}

export type UiBlockStatus = "pending" | "answered" | "expired" | "closed";
export const UI_BLOCK_STATUSES = [
  "pending",
  "answered",
  "expired",
  "closed",
] as const satisfies readonly UiBlockStatus[];

/**
 * The answer the host gives itself when nobody answers first, such as the Start button of the plan
 * card that `acknowledge_request` shows. Only the host sets it; an agent cannot.
 */
export interface UiBlockAutoAnswer {
  /** One of the block's actions. */
  actionId: string;
  /** ISO time. The host answers at this time. */
  at: string;
  /** The host gave the answer: nobody answered before `at`. */
  done?: boolean;
}

export interface UiBlockState {
  status: UiBlockStatus;
  /** Required when `answered`. */
  response?: UiBlockResponse;
  respondedBy?: ConversationMessageSender;
  /** ISO time. */
  respondedAt?: string;
  /** The line the frozen block shows, such as the chosen button. See `uiBlockOutcomeText`. */
  outcome?: string;
  /** Not on the `ui-blocks-v1` wire: a remote client shows the block without the countdown. */
  autoAnswer?: UiBlockAutoAnswer;
}

/** The Vault items that `request_vault_item` asks the user for. */
export type UiVaultRequestKind = "login" | "card" | "contact";
export const UI_VAULT_REQUEST_KINDS = [
  "login",
  "card",
  "contact",
] as const satisfies readonly UiVaultRequestKind[];

export const UI_VAULT_REQUEST_FIELDS = {
  login: ["website", "username", "password"],
  card: ["label", "nameOnCard", "number", "expiry", "securityCode"],
  contact: [
    "label",
    "fullName",
    "address",
    "address2",
    "city",
    "region",
    "postalCode",
    "country",
    "phone",
    "email",
  ],
} as const satisfies Record<UiVaultRequestKind, readonly string[]>;

export type UiVaultRequestField<Kind extends UiVaultRequestKind = UiVaultRequestKind> =
  (typeof UI_VAULT_REQUEST_FIELDS)[Kind][number];

/** The fields that only the user types: an agent cannot fill them in, and the stored block drops them. */
export const UI_VAULT_SECRET_FIELDS: readonly UiVaultRequestField[] = [
  "password",
  "number",
  "securityCode",
];

/** The item that the user saved from a Vault request. It holds no secret: a card gives its last four digits only. */
export interface UiVaultSavedItem {
  id: string;
  /** The name that the user knows the item by, as the Vault gives it. */
  name: string;
  brand?: VaultCardBrand;
  last4?: string;
}

/**
 * The block is the form of `request_vault_item`: the app draws a Vault card in its place, which opens
 * the Vault dialog. The form fields stay the fallback of a client that does not know this key.
 */
export interface UiBlockVaultRequest {
  kind: UiVaultRequestKind;
  /** Set when the user saved the item. */
  saved?: UiVaultSavedItem;
}

/** The `uiBlock` field of a `ConversationMessage`. */
export interface ConversationUiBlock {
  version: typeof UI_BLOCK_VERSION;
  /** Given by the agent or made by the host. */
  blockId: string;
  spec: UiBlockSpec;
  state: UiBlockState;
  /**
   * Only the host sets it. Not on the `ui-blocks-v1` wire: a remote client shows the form of the
   * block.
   */
  vault?: UiBlockVaultRequest;
}

export function isUiBlockType(value: unknown): value is UiBlockType {
  return isOneOf(UI_BLOCK_TYPES, value);
}

/**
 * An id an agent may give. Ids that start with `_` are OpenBot's own (`_text`, and `__proto__` can never
 * become a record key), and the legacy `bot*` key names are refused because the stored tree renames them.
 */
export function isUiBlockId(value: unknown): value is string {
  return (
    isString(value) &&
    UI_BLOCK_ID_PATTERN.test(value) &&
    !value.startsWith("_") &&
    !LEGACY_KEY_IDS.has(value)
  );
}

class InvalidUiBlock extends Error {}

function fail(): never {
  throw new InvalidUiBlock();
}

function check(condition: boolean): asserts condition {
  if (!condition) fail();
}

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof InvalidUiBlock) return null;
    throw error;
  }
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function readRecord(value: unknown): DynamicRecord {
  check(isDynamicRecord(value));
  return value;
}

/** A string within `max`; `nonBlank` also refuses an empty or all-space one. */
function readString(value: unknown, max: number, nonBlank = true): string {
  check(isBoundedString(value, max) && (!nonBlank || value.trim().length > 0));
  return value;
}

function readOptionalString(value: unknown, max: number): string | undefined {
  return value === undefined ? undefined : readString(value, max);
}

function readId(value: unknown): string {
  check(isUiBlockId(value));
  return value;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  check(isBoolean(value));
  return value;
}

function readNumber(value: unknown, min: number, max: number, integer = false): number {
  check(isNumber(value) && Number.isFinite(value) && value >= min && value <= max);
  check(!integer || Number.isInteger(value));
  return value;
}

function readOptionalNumber(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number | undefined {
  return value === undefined ? undefined : readNumber(value, min, max, integer);
}

function readArray(value: unknown, max: number, min = 0): readonly unknown[] {
  check(Array.isArray(value) && value.length >= min && value.length <= max);
  return value;
}

function readOneOf<T extends string>(values: readonly T[], value: unknown): T {
  check(isOneOf(values, value));
  return value;
}

function readOptionalOneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return value === undefined ? undefined : readOneOf(values, value);
}

function checkUnique(values: readonly string[]): void {
  check(new Set(values).size === values.length);
}

function readAction(value: unknown): UiAction {
  const record = readRecord(value);
  const action: UiAction = {
    id: readId(record.id),
    label: readString(record.label, UI_BLOCK_LIMITS.label),
  };
  const style = readOptionalOneOf(UI_ACTION_STYLES, record.style);
  if (style !== undefined) action.style = style;
  const confirm = readOptionalBoolean(record.confirm);
  if (confirm !== undefined) action.confirm = confirm;
  return action;
}

function readActions(value: unknown, min: number): UiAction[] {
  const actions = readArray(value, UI_BLOCK_LIMITS.actions, min).map(readAction);
  checkUnique(actions.map((action) => action.id));
  return actions;
}

function readOption(value: unknown): UiOption {
  const record = readRecord(value);
  return { id: readId(record.id), label: readString(record.label, UI_BLOCK_LIMITS.label) };
}

/** Option labels must be unique too: an answer from a client that only saw the fallback names the label. */
function checkUniqueOptions(options: readonly UiOption[]): void {
  checkUnique(options.map((option) => option.id));
  checkUnique(options.map((option) => option.label.trim().toLowerCase()));
}

function readStringOptions(value: unknown, max: number): string[] {
  const options = readArray(value, max, 1).map((option) =>
    readString(option, UI_BLOCK_LIMITS.label),
  );
  checkUnique(options.map((option) => option.trim().toLowerCase()));
  return options;
}

function readConfirmField(value: unknown): UiConfirmField {
  const record = readRecord(value);
  const label = readString(record.label, UI_BLOCK_LIMITS.label);
  if (record.select !== undefined) {
    const select = readId(record.select);
    check(select !== UI_CONFIRM_ACTION_QUESTION_ID);
    return {
      label,
      select,
      options: readStringOptions(record.options, UI_BLOCK_LIMITS.selectOptions),
    };
  }
  return { label, value: readString(record.value, UI_BLOCK_LIMITS.text, false) };
}

function readConfirm(record: DynamicRecord): UiConfirmBlock {
  const block: UiConfirmBlock = {
    type: "confirm",
    title: readString(record.title, UI_BLOCK_LIMITS.title),
    actions: readActions(record.actions, 1),
  };
  const danger = readOptionalBoolean(record.danger);
  if (danger !== undefined) block.danger = danger;
  const hold = readOptionalNumber(
    record.confirmHold,
    UI_BLOCK_LIMITS.holdMinMs,
    UI_BLOCK_LIMITS.holdMaxMs,
    true,
  );
  if (hold !== undefined) block.confirmHold = hold;
  if (record.fields !== undefined) {
    const fields = readArray(record.fields, UI_BLOCK_LIMITS.confirmFields).map(readConfirmField);
    checkUnique(fields.flatMap((field) => ("select" in field ? [field.select] : [])));
    block.fields = fields;
  }
  const preview = readOptionalString(record.preview, UI_BLOCK_LIMITS.preview);
  if (preview !== undefined) block.preview = preview;
  checkUnique(block.actions.map((action) => action.label.trim().toLowerCase()));
  return block;
}

function readQuickReplies(record: DynamicRecord): UiQuickRepliesBlock {
  const options = readArray(record.options, UI_BLOCK_LIMITS.quickReplies, 1).map(readOption);
  checkUniqueOptions(options);
  const block: UiQuickRepliesBlock = { type: "quick_replies", options };
  const title = readOptionalString(record.title, UI_BLOCK_LIMITS.title);
  if (title !== undefined) block.title = title;
  const allowText = readOptionalBoolean(record.allowText);
  if (allowText !== undefined) block.allowText = allowText;
  return block;
}

function readChoiceOption(value: unknown): UiChoiceOption {
  const record = readRecord(value);
  const option: UiChoiceOption = readOption(record);
  const meta = readOptionalString(record.meta, UI_BLOCK_LIMITS.meta);
  if (meta !== undefined) option.meta = meta;
  const selected = readOptionalBoolean(record.selected);
  if (selected !== undefined) option.selected = selected;
  return option;
}

function readChoice(record: DynamicRecord): UiChoiceBlock {
  const options = readArray(record.options, UI_BLOCK_LIMITS.choiceOptions, 1).map(readChoiceOption);
  checkUniqueOptions(options);
  const block: UiChoiceBlock = {
    type: "choice",
    title: readString(record.title, UI_BLOCK_LIMITS.title),
    options,
  };
  const multiple = readOptionalBoolean(record.multiple);
  if (multiple !== undefined) block.multiple = multiple;
  check(multiple === true || options.filter((option) => option.selected).length <= 1);
  const submit = readOptionalString(record.submit, UI_BLOCK_LIMITS.label);
  if (submit !== undefined) block.submit = submit;
  return block;
}

/** A form field whose value OpenBot does not store. See `UiFormTextField.secret`. */
export function isSecretFormField(field: UiFormField): boolean {
  return field.kind === "text" && field.secret === true;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isUiDate(value: unknown): value is string {
  if (!isString(value) || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readFormField(value: unknown): UiFormField {
  const record = readRecord(value);
  const id = readId(record.id);
  const kind = readOneOf(["text", "textarea", "select", "segmented", "date"] as const, record.kind);
  const required = readOptionalBoolean(record.required);
  let field: UiFormField;
  if (kind === "select" || kind === "segmented") {
    const options = readStringOptions(
      record.options,
      kind === "select" ? UI_BLOCK_LIMITS.selectOptions : UI_BLOCK_LIMITS.segmentedOptions,
    );
    const optionsField: UiFormOptionsField = { id, kind, options };
    const label = readOptionalString(record.label, UI_BLOCK_LIMITS.label);
    if (label !== undefined) optionsField.label = label;
    if (record.value !== undefined) {
      check(isOneOf(options, record.value));
      optionsField.value = record.value;
    }
    field = optionsField;
  } else if (kind === "date") {
    const dateField: UiFormDateField = {
      id,
      kind,
      label: readString(record.label, UI_BLOCK_LIMITS.label),
    };
    if (record.value !== undefined) {
      check(isUiDate(record.value));
      dateField.value = record.value;
    }
    field = dateField;
  } else {
    const textField: UiFormTextField = {
      id,
      kind,
      label: readString(record.label, UI_BLOCK_LIMITS.label),
    };
    const placeholder = readOptionalString(record.placeholder, UI_BLOCK_LIMITS.label);
    if (placeholder !== undefined) textField.placeholder = placeholder;
    if (record.value !== undefined)
      textField.value = readString(record.value, UI_BLOCK_LIMITS.fieldValue, false);
    const secret = readOptionalBoolean(record.secret);
    if (secret === true) check(kind === "text" && textField.value === undefined);
    if (secret !== undefined) textField.secret = secret;
    field = textField;
  }
  if (required !== undefined) field.required = required;
  return field;
}

function readForm(record: DynamicRecord): UiFormBlock {
  const fields = readArray(record.fields, UI_BLOCK_LIMITS.formFields, 1).map(readFormField);
  checkUnique(fields.map((field) => field.id));
  const block: UiFormBlock = {
    type: "form",
    title: readString(record.title, UI_BLOCK_LIMITS.title),
    fields,
  };
  const submit = readOptionalString(record.submit, UI_BLOCK_LIMITS.label);
  if (submit !== undefined) block.submit = submit;
  return block;
}

function readSpec(value: unknown): UiBlockSpec {
  check(jsonLength(value) <= UI_BLOCK_LIMITS.specJson);
  const record = readRecord(value);
  const type = readOneOf(UI_BLOCK_TYPES, record.type);
  switch (type) {
    case "confirm":
      return readConfirm(record);
    case "quick_replies":
      return readQuickReplies(record);
    case "choice":
      return readChoice(record);
    case "form":
      return readForm(record);
  }
}

export function normalizeUiBlockSpec(value: unknown): UiBlockSpec | null {
  return attempt(() => readSpec(value));
}

export function isUiBlockSpec(value: unknown): value is UiBlockSpec {
  return normalizeUiBlockSpec(value) !== null;
}

function actionsOf(spec: UiBlockSpec): readonly UiAction[] {
  return spec.type === "confirm" ? spec.actions : [];
}

/** The entries of a response's `values`, with every key a valid id. The values are checked by the caller. */
function readValues(value: unknown, max: number): Map<string, unknown> {
  const entries = Object.entries(readRecord(value));
  check(entries.length <= max);
  return new Map(entries.map(([key, entry]) => [readId(key), entry] as const));
}

function readResponseValues(
  spec: UiBlockSpec,
  record: DynamicRecord,
  actionId: string,
  stored: boolean,
): Record<string, UiBlockValue> | undefined {
  if (actionId === UI_BLOCK_TEXT_ACTION_ID) {
    check(record.values === undefined);
    return undefined;
  }
  switch (spec.type) {
    case "confirm": {
      if (record.values === undefined) return undefined;
      const selects = new Map(
        (spec.fields ?? []).flatMap((field) =>
          "select" in field ? [[field.select, field.options] as const] : [],
        ),
      );
      const raw = readValues(record.values, selects.size);
      const values: Record<string, UiBlockValue> = {};
      for (const [key, entry] of raw) {
        const options = selects.get(key);
        check(options !== undefined && isOneOf(options, entry));
        values[key] = entry;
      }
      return values;
    }
    case "choice": {
      const raw = readValues(record.values, 1);
      const selected = raw.get(UI_CHOICE_VALUES_KEY);
      const ids = spec.options.map((option) => option.id);
      const chosen = readArray(selected, spec.multiple ? ids.length : 1, 1).map((id) => {
        check(isOneOf(ids, id));
        return id;
      });
      checkUnique(chosen);
      return { [UI_CHOICE_VALUES_KEY]: chosen };
    }
    case "form": {
      const raw =
        record.values === undefined
          ? new Map<string, unknown>()
          : readValues(record.values, spec.fields.length);
      const values: Record<string, UiBlockValue> = {};
      const fields = new Map(spec.fields.map((field) => [field.id, field] as const));
      for (const key of raw.keys()) check(fields.has(key));
      for (const field of spec.fields) {
        // A stored response never holds a secret value; reading one drops it.
        const secret = isSecretFormField(field);
        const entry = stored && secret ? undefined : raw.get(field.id);
        if (entry === undefined || entry === "") {
          check(field.required !== true || (stored && secret));
          if (entry === "") values[field.id] = "";
          continue;
        }
        if (field.kind === "select" || field.kind === "segmented") {
          check(isOneOf(field.options, entry));
          values[field.id] = entry;
        } else if (field.kind === "date") {
          check(isUiDate(entry));
          values[field.id] = entry;
        } else values[field.id] = readString(entry, UI_BLOCK_LIMITS.fieldValue, false);
      }
      return values;
    }
    default:
      check(record.values === undefined);
      return undefined;
  }
}

function checkActionId(spec: UiBlockSpec, actionId: string): void {
  if (actionId === UI_BLOCK_TEXT_ACTION_ID) return;
  switch (spec.type) {
    case "quick_replies":
      check(spec.options.some((option) => option.id === actionId));
      break;
    case "choice":
    case "form":
      check(actionId === UI_BLOCK_SUBMIT_ACTION_ID);
      break;
    case "confirm":
      check(spec.actions.some((action) => action.id === actionId));
  }
}

/** `stored` reads a response from a stored state, which leaves out the value of a secret field. */
function readResponse(spec: UiBlockSpec, value: unknown, stored = false): UiBlockResponse {
  check(jsonLength(value) <= UI_BLOCK_LIMITS.responseJson);
  const record = readRecord(value);
  check(isString(record.actionId));
  const actionId = record.actionId;
  checkActionId(spec, actionId);
  const response: UiBlockResponse = { actionId };
  const values = readResponseValues(spec, record, actionId, stored);
  if (values !== undefined) response.values = values;
  if (actionId === UI_BLOCK_TEXT_ACTION_ID)
    response.text = readString(record.text, UI_BLOCK_LIMITS.fieldValue);
  else check(record.text === undefined);
  return response;
}

export function validateUiBlockResponse(spec: UiBlockSpec, value: unknown): UiBlockResponse | null {
  return attempt(() => readResponse(spec, value));
}

export function isUiBlockResponseFor(spec: UiBlockSpec, value: unknown): value is UiBlockResponse {
  return validateUiBlockResponse(spec, value) !== null;
}

export function uiBlockActionIsPrivileged(spec: UiBlockSpec, actionId: string): boolean {
  const action = actionsOf(spec).find((candidate) => candidate.id === actionId);
  if (!action) return false;
  if (action.style === "danger" || action.confirm === true) return true;
  return spec.type === "confirm" && spec.danger === true && action.style === "primary";
}

export function uiBlockHasPrivilegedAction(spec: UiBlockSpec): boolean {
  return actionsOf(spec).some((action) => uiBlockActionIsPrivileged(spec, action.id));
}

function readSender(value: unknown): ConversationMessageSender {
  const record = readRecord(value);
  check(isIdentifier(record.id) && isBoundedString(record.name, INPUT_LIMITS.accountName));
  return { id: record.id, name: record.name };
}

function readAutoAnswer(spec: UiBlockSpec, value: unknown): UiBlockAutoAnswer {
  const record = readRecord(value);
  const actionId = readId(record.actionId);
  check(actionsOf(spec).some((action) => action.id === actionId));
  const at = readString(record.at, UI_BLOCK_LIMITS.timestamp);
  check(Number.isFinite(Date.parse(at)));
  const autoAnswer: UiBlockAutoAnswer = { actionId, at };
  const done = readOptionalBoolean(record.done);
  if (done !== undefined) autoAnswer.done = done;
  return autoAnswer;
}

function readState(spec: UiBlockSpec, value: unknown): UiBlockState {
  const record = readRecord(value);
  const state: UiBlockState = { status: readOneOf(UI_BLOCK_STATUSES, record.status) };
  if (record.response !== undefined) state.response = readResponse(spec, record.response, true);
  check(state.status !== "answered" || state.response !== undefined);
  if (record.respondedBy !== undefined) state.respondedBy = readSender(record.respondedBy);
  const respondedAt = readOptionalString(record.respondedAt, UI_BLOCK_LIMITS.timestamp);
  if (respondedAt !== undefined) state.respondedAt = respondedAt;
  const outcome = readOptionalString(record.outcome, UI_BLOCK_LIMITS.outcome);
  if (outcome !== undefined) state.outcome = outcome;
  if (record.autoAnswer !== undefined) state.autoAnswer = readAutoAnswer(spec, record.autoAnswer);
  return state;
}

function readVaultRequest(spec: UiBlockSpec, value: unknown): UiBlockVaultRequest {
  const record = readRecord(value);
  check(spec.type === "form");
  const request: UiBlockVaultRequest = { kind: readOneOf(UI_VAULT_REQUEST_KINDS, record.kind) };
  if (record.saved === undefined) return request;
  const saved = readRecord(record.saved);
  check(isIdentifier(saved.id));
  const item: UiVaultSavedItem = {
    id: saved.id,
    name: readString(saved.name, VAULT_TEXT_LIMIT, false),
  };
  if (saved.brand !== undefined) item.brand = readOneOf(VAULT_CARD_BRANDS, saved.brand);
  if (saved.last4 !== undefined) {
    check(isString(saved.last4) && /^\d{4}$/u.test(saved.last4));
    item.last4 = saved.last4;
  }
  request.saved = item;
  return request;
}

function readConversationUiBlock(value: unknown): ConversationUiBlock {
  const record = readRecord(value);
  check(record.version === UI_BLOCK_VERSION);
  const spec = readSpec(record.spec);
  const block: ConversationUiBlock = {
    version: UI_BLOCK_VERSION,
    blockId: readId(record.blockId),
    spec,
    state: readState(spec, record.state),
  };
  if (record.vault !== undefined) block.vault = readVaultRequest(spec, record.vault);
  return block;
}

/**
 * The block with only known keys, or null when any part of it is malformed. The response leaves out the
 * value of a secret form field. The backend stores what this returns, so a stored block always reads.
 */
export function normalizeConversationUiBlock(value: unknown): ConversationUiBlock | null {
  return attempt(() => readConversationUiBlock(value));
}

/** The guard `isConversationMessage` uses. A malformed block fails the whole message. */
export function isConversationUiBlock(value: unknown): value is ConversationUiBlock {
  return normalizeConversationUiBlock(value) !== null;
}

export function uiBlockAnswersFromResponse(
  spec: UiBlockSpec,
  response: UiBlockResponse,
): Record<string, string[]> {
  if (response.actionId === UI_BLOCK_TEXT_ACTION_ID) {
    throw new Error("Free-text fallback is unavailable in this integration.");
  }
  const values = response.values ?? {};
  switch (spec.type) {
    case "confirm": {
      const action = spec.actions.find((candidate) => candidate.id === response.actionId);
      const answers: Record<string, string[]> = {
        [UI_CONFIRM_ACTION_QUESTION_ID]: [action?.label ?? response.actionId],
      };
      for (const [key, value] of Object.entries(values)) answers[key] = [String(value)];
      return answers;
    }
    case "quick_replies": {
      const option = spec.options.find((candidate) => candidate.id === response.actionId);
      return { [UI_QUICK_REPLIES_QUESTION_ID]: [option?.label ?? response.actionId] };
    }
    case "choice": {
      const selected = values[UI_CHOICE_VALUES_KEY];
      const ids = Array.isArray(selected) ? selected : [];
      const labels = ids.map((id) => spec.options.find((option) => option.id === id)?.label ?? id);
      return { [UI_CHOICE_QUESTION_ID]: spec.multiple ? [labels.join("\n")] : labels };
    }
    case "form": {
      const answers: Record<string, string[]> = {};
      for (const field of spec.fields) {
        const value = values[field.id];
        if (value !== undefined && value !== "") answers[field.id] = [String(value)];
      }
      return answers;
    }
  }
}
