/* oxlint-disable shadcn/no-unknown-classes -- Ported OpenBot confirmation selectors are defined in the scoped stylesheet. */
import { useRef } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Trash2Icon } from "lucide-react";
import "./OpenbotSidebarDeleteDialog.css";

// Source confirm-dialog.tsx and SidebarDialogs.tsx: failed deletion stays open; pending blocks dismissal.
export function SidebarDeleteDialog({
  name,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <div className="openbot-react">
          <AlertDialog.Viewport
            className="ui-dialog-overlay ui-confirm-dialog-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget && !pending) onCancel();
            }}
          >
            <AlertDialog.Popup
              initialFocus={confirm}
              className="ui-dialog-content ui-confirm-dialog"
              data-tone="destructive"
            >
              <div className="ui-confirm-dialog-main">
                <span className="ui-confirm-dialog-icon" aria-hidden="true">
                  <Trash2Icon />
                </span>
                <div className="ui-confirm-dialog-content">
                  <AlertDialog.Title className="ui-confirm-dialog-title">
                    Delete {name}?
                  </AlertDialog.Title>
                  <AlertDialog.Description className="ui-confirm-dialog-description">
                    The chats and folders in this folder move up one level. No agent or channel is
                    deleted.
                  </AlertDialog.Description>
                  {error && (
                    <p role="alert" className="ob-sidebar-delete-error">
                      {error}
                    </p>
                  )}
                </div>
              </div>
              <footer className="ui-confirm-dialog-actions">
                <button
                  type="button"
                  className="ui-button ui-button-size-default ui-button-variant-ghost"
                  disabled={pending}
                  onClick={onCancel}
                >
                  Cancel
                </button>
                <button
                  ref={confirm}
                  type="button"
                  className="ui-button ui-button-size-default ui-button-variant-destructive ui-confirm-dialog-confirm"
                  disabled={pending}
                  onClick={() => void onConfirm()}
                >
                  <Trash2Icon aria-hidden="true" />
                  {pending ? "Deleting…" : "Delete"}
                </button>
              </footer>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
