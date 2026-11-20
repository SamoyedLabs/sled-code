/** Explicit overrides win; validated updates supersede the app's bundled baseline. */
export function resolveRuntimeExecutable(input: {
  override?: string | undefined;
  installed?: string | undefined;
  bundled?: string | undefined;
}) {
  const override = input.override?.trim();
  return {
    executablePath: override || input.installed?.trim() || input.bundled?.trim() || undefined,
    allowExecutableSwitch: !override,
  };
}
