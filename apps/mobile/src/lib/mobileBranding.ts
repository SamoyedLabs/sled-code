export const SLED_SHORT_NAME = "Sled";
export const SLED_PRODUCT_NAME = "Sled Code";
export const SLED_CONNECT_NAME = "Sled Connect";

export type MobileStageLabel = "Beta" | "Dev" | "Nightly";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return "Beta";
}

export function usesDarkMobileMascot(appVariant: unknown) {
  return appVariant === "development";
}
