// @effect-diagnostics nodeBuiltinImport:off -- Build-time launch metadata never runs in the application or a remote session.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export function privateDesktopLaunchEnvironment(
  home: string,
  publicSettings: Readonly<Record<string, string>>,
) {
  const profile = home.trim();
  const liveHome = NodePath.join(NodeOS.homedir(), ".t3");
  const relativeToLive = NodePath.relative(NodePath.join(liveHome, "userdata"), profile);
  if (
    !NodePath.isAbsolute(profile) ||
    NodePath.resolve(profile) === liveHome ||
    relativeToLive === "" ||
    (relativeToLive !== ".." &&
      !relativeToLive.startsWith(`..${NodePath.sep}`) &&
      !NodePath.isAbsolute(relativeToLive))
  ) {
    throw new Error("The private desktop needs an absolute profile outside the installed T3 home.");
  }
  const environment: Record<string, string> = {
    T3CODE_HOME: profile,
    T3CODE_DISABLE_AUTO_UPDATE: "true",
  };
  for (const key of [
    "T3CODE_RELAY_URL",
    "T3CODE_CLERK_PUBLISHABLE_KEY",
    "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
    "T3CODE_CLERK_JWT_TEMPLATE",
  ]) {
    const value = publicSettings[key]?.trim();
    if (value) environment[key] = value;
  }
  return environment;
}
