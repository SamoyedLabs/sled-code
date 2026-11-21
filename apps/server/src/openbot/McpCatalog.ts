import type { OpenbotAdminRequest, OpenbotMcpConfig } from "@t3tools/contracts";
type CatalogApp = Extract<OpenbotAdminRequest, { operation: "mcp.catalogMatches" }>["apps"][number];
function accountFragment(url: string) {
  const index = url.indexOf("#");
  return index >= 0 && /^#account-[A-Za-z0-9-]{1,64}$/.test(url.slice(index).trim())
    ? url.slice(0, index)
    : null;
}
function matches(config: OpenbotMcpConfig, app: CatalogApp) {
  if (config.transport !== app.transport) return false;
  if (app.transport === "stdio")
    return (
      config.name === app.name &&
      config.command === app.command &&
      config.args.length === app.args.length &&
      config.args.every((arg, index) => arg === app.args[index])
    );
  const withoutFragment = accountFragment(config.url);
  if (withoutFragment === null && config.name !== app.name) return false;
  const value = withoutFragment ?? config.url;
  if (!app.userLink) return value === app.url;
  try {
    const url = new URL(value),
      listing = new URL(app.url);
    return (
      url.protocol === "https:" &&
      (url.hostname === listing.hostname || url.hostname.endsWith(`.${listing.hostname}`))
    );
  } catch {
    return false;
  }
}
export function catalogMatches(apps: readonly CatalogApp[], configs: readonly OpenbotMcpConfig[]) {
  return {
    matches: apps.map((app) => {
      const held = configs.filter((config) => matches(config, app));
      return {
        appId: app.id,
        mcpServerIds: held.map((config) => config.id),
        accountMcpServerIds: held
          .filter((config) => config.transport === "http" && accountFragment(config.url) !== null)
          .map((config) => config.id),
      };
    }),
  };
}
