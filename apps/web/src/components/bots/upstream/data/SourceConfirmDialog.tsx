/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot confirm-dialog.tsx classes. */
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef, useState, type ReactNode } from "react";
import { ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import "../OpenbotSidebarDeleteDialog.css";
import { t } from "./source-text";

export function SourceConfirmDialog(props: {
  open: boolean;
  title: ReactNode;
  tone?: "destructive" | "default";
  icon?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  initialFocus?: "confirm" | "cancel";
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const confirm = useRef<HTMLButtonElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const [running, setRunning] = useState(false);
  const pending = Boolean(props.pending || running);
  const submit = async () => {
    if (lock.current || pending) return;
    lock.current = true;
    setRunning(true);
    try {
      await props.onConfirm();
    } finally {
      lock.current = false;
      setRunning(false);
    }
  };
  return (
    <AlertDialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !pending) props.onCancel();
      }}
    >
      <AlertDialog.Portal>
        <div className="openbot-react">
          <AlertDialog.Viewport
            className="ui-dialog-overlay ui-confirm-dialog-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget && !pending) props.onCancel();
            }}
          >
            <AlertDialog.Popup
              initialFocus={props.initialFocus === "cancel" ? cancel : confirm}
              className="ui-dialog-content ui-confirm-dialog"
              data-tone={props.tone ?? "destructive"}
            >
              <div className="ui-confirm-dialog-main">
                <span className="ui-confirm-dialog-icon" aria-hidden="true">
                  {props.icon ?? (props.tone === "default" ? <ShieldCheck /> : <Trash2 />)}
                </span>
                <div className="ui-confirm-dialog-content">
                  <AlertDialog.Title className="ui-confirm-dialog-title">
                    {props.title}
                  </AlertDialog.Title>
                  {props.description && (
                    <AlertDialog.Description className="ui-confirm-dialog-description">
                      {props.description}
                    </AlertDialog.Description>
                  )}
                  {props.children && <div className="ui-confirm-dialog-body">{props.children}</div>}
                  {props.error && (
                    <div
                      className="ui-alert ui-confirm-dialog-error"
                      data-tone="danger"
                      role="alert"
                    >
                      <span className="ui-alert-icon">
                        <TriangleAlert />
                      </span>
                      <div className="ui-alert-content">
                        <p className="ui-alert-description">{props.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <footer className="ui-confirm-dialog-actions">
                <button
                  ref={cancel}
                  type="button"
                  className="ui-button ui-button-size-default ui-button-variant-ghost"
                  disabled={pending}
                  onClick={props.onCancel}
                >
                  {t("common.cancel")}
                </button>
                <button
                  ref={confirm}
                  type="button"
                  className={`ui-button ui-button-size-default ui-button-variant-${props.tone === "default" ? "default" : "destructive"} ui-confirm-dialog-confirm`}
                  disabled={pending}
                  onClick={() => void submit()}
                >
                  {pending ? (props.pendingLabel ?? props.confirmLabel) : props.confirmLabel}
                </button>
              </footer>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
