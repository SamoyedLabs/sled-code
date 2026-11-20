export function openbotAdminCommandKey(environmentId: string, operation: string) {
  // Navigation waits for page loading; reads and Stop must not wait behind it.
  return JSON.stringify([
    environmentId,
    ["browser.open", "browser.load", "browser.navigate", "browser.reload"].includes(operation)
      ? "browser-navigation"
      : "admin",
  ]);
}
