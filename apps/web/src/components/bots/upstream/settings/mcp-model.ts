/* oxlint-disable t3code/no-low-value-comments -- Source contract comments retain credential-preservation and normalization invariants. */

const INPUT_LIMITS = { mcpServerName: 80, mcpUrl: 2048 };

const RESERVED_MCP_SERVER_NAMES = ["openbot", "openbot_browser"];

const COMPUTER_USE_MCP_SERVER_NAME = "computer_use";

export type McpTransport = "stdio" | "http";

export interface McpKeyValue {
  key: string;
  value: string;
}

/**
 * A configured MCP server. Both transports' fields live on one record rather than in a union: the
 * form keeps what the user typed under the other transport while they compare the two, and
 * `normalizeMcpConfig` is what drops the side that does not apply on the way out.
 */
export interface McpRetainedFields {
  args?: number;
  env?: readonly string[];
  headers?: readonly string[];
}

export interface McpServerConfig {
  retained?: McpRetainedFields;
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  /** stdio */
  command: string;
  args: string[];
  env: McpKeyValue[];
  envPassthrough: string[];
  workingDirectory: string;
  /** streamable http */
  url: string;
  headers: McpKeyValue[];
}

/**
 * What one test connection found: the tools the server offered, or the sentence that says why it
 * did not answer.
 *
 * Nothing stores this. OpenBot connects only when the user asks it to, because a connection is not
 * free - an http server can want an OAuth sign-in, a cold `npx` can take a minute, and a server can
 * do real work at startup. A stored result would also be a claim about right now that nothing keeps
 * true. The providers make their own connections when an agent starts.
 */
export interface McpTestResult {
  toolCount: number;
  error: string | null;
}

export interface McpConfigErrors {
  name?: string;
  command?: string;
  url?: string;
}

export function mcpConfigErrors(config: McpServerConfig): McpConfigErrors {
  const errors: McpConfigErrors = {};
  const name = config.name.trim();
  if (!name) errors.name = "Enter a name for this MCP server.";
  else if (name.length > INPUT_LIMITS.mcpServerName)
    errors.name = `Use ${INPUT_LIMITS.mcpServerName} characters or fewer for the name.`;
  else if (isReservedMcpServerName(name) || name.toLowerCase() === COMPUTER_USE_MCP_SERVER_NAME)
    errors.name = `OpenBot already uses the name ${name}.`;
  if (config.transport === "stdio") {
    if (!config.command.trim()) errors.command = "Enter the command that launches this server.";
    return errors;
  }
  if (!isHttpUrl(config.url)) errors.url = "Enter an http or https address.";
  return errors;
}

export function mcpConfigIsValid(config: McpServerConfig): boolean {
  return Object.keys(mcpConfigErrors(config)).length === 0;
}

export function isReservedMcpServerName(name: string): boolean {
  return RESERVED_MCP_SERVER_NAMES.some((reserved) => reserved === name.trim().toLowerCase());
}

/**
 * What a save sends: the surrounding spaces of each name taken off, the empty rows the form shows
 * dropped, and the transport the user did not choose cleared, so a stored configuration never
 * carries a half-typed alternative.
 *
 * A value is kept exactly as written - an argument as well as a credential. An argument is handed
 * to the process as one word, so a token or a file name that ends in a space is a different word
 * once it is trimmed, and the form's change check runs this same normalization, which would read
 * the space typed back as no change at all.
 */
export function normalizeMcpConfig(config: McpServerConfig): McpServerConfig {
  const stdio = config.transport === "stdio";
  return {
    ...config,
    name: config.name.trim(),
    command: stdio ? config.command.trim() : "",
    args: stdio ? config.args.filter((value) => value.trim().length > 0) : [],
    env: stdio ? normalizePairs(config.env) : [],
    envPassthrough: stdio ? config.envPassthrough.map((value) => value.trim()).filter(Boolean) : [],
    workingDirectory: stdio ? config.workingDirectory.trim() : "",
    url: stdio ? "" : config.url.trim(),
    headers: stdio ? [] : normalizePairs(config.headers),
  };
}

function normalizePairs(pairs: McpKeyValue[]): McpKeyValue[] {
  return pairs
    .map((pair) => ({ key: pair.key.trim(), value: pair.value }))
    .filter((pair) => pair.key.length > 0);
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > INPUT_LIMITS.mcpUrl) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function emptyMcpConfig(): McpServerConfig {
  return {
    id: "",
    name: "",
    transport: "stdio",
    enabled: true,
    command: "",
    args: [""],
    env: [{ key: "", value: "" }],
    envPassthrough: [""],
    workingDirectory: "",
    url: "",
    headers: [{ key: "", value: "" }],
  };
}

/**
 * An existing configuration reopened for editing. Saving strips the empty rows, so a stored
 * configuration has none; put one back in each list to give the user somewhere to type.
 */
export function mcpConfigDraft(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    args: config.args.length > 0 ? [...config.args] : [""],
    env: config.env.length > 0 ? config.env.map((pair) => ({ ...pair })) : [{ key: "", value: "" }],
    envPassthrough: config.envPassthrough.length > 0 ? [...config.envPassthrough] : [""],
    headers:
      config.headers.length > 0
        ? config.headers.map((pair) => ({ ...pair }))
        : [{ key: "", value: "" }],
  };
}

/**
 * Whether the form holds a change worth saving. The comparison is between the normalized values, so
 * adding an empty row, or typing a trailing space, does not count as an edit.
 */
export function mcpConfigChanged(draft: McpServerConfig, baseline: McpServerConfig): boolean {
  return JSON.stringify(normalizeMcpConfig(draft)) !== JSON.stringify(normalizeMcpConfig(baseline));
}

/**
 * Whether Save connects before it stores: a new http server, or an edit that changes where or how
 * it connects. A rename or a stdio server saves at once, as before.
 */
export function mcpSaveConnects(
  draft: McpServerConfig,
  baseline: McpServerConfig,
  isNew: boolean,
): boolean {
  if (draft.transport !== "http") return false;
  if (isNew || baseline.transport !== "http") return true;
  const next = normalizeMcpConfig(draft);
  const stored = normalizeMcpConfig(baseline);
  return (
    next.url !== stored.url ||
    JSON.stringify(next.headers) !== JSON.stringify(stored.headers) ||
    (baseline.retained?.headers !== undefined && draft.retained?.headers === undefined)
  );
}

/** A value in the stdio command that is a web address: it names an http server, not a program. */
export function isMcpHttpAddress(value: string): boolean {
  return /^https?:\/\/\S/i.test(value.trim());
}
