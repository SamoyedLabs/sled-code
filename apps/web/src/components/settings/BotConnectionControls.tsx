import type { ReactNode } from "react";
import { botConnectionUrl } from "@t3tools/client-runtime/openbot/presentation";
import { requestConfirmDialog } from "../../confirmDialog";

export async function confirmed(message: string) {
  return (
    (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message)
  );
}

export function ExternalLink({
  address,
  children,
  disabled = false,
}: {
  address: string | null;
  children: ReactNode;
  disabled?: boolean;
}) {
  const url = botConnectionUrl(address);
  return url && disabled ? (
    <span className="text-sm text-muted-foreground" aria-disabled="true">
      {children}
    </span>
  ) : url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-sm underline">
      {children}
    </a>
  ) : null;
}
