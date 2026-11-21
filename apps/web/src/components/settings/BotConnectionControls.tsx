import { requestConfirmDialog } from "../../confirmDialog";

export async function confirmed(message: string) {
  return (
    (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message)
  );
}
