/* oxlint-disable shadcn/no-unknown-classes -- Pinned SharedTablesModal.tsx DOM and source CSS. */
import { Dialog } from "@base-ui/react/dialog";
import { Trash2, X } from "lucide-react";
import { useRef } from "react";
import type { OpenbotSharedTables } from "@t3tools/contracts";
import { SourceButton } from "../settings/SettingsParts";
import { t } from "./source-text";
import { useSourceScrollFades } from "./useSourceScrollFades";
import "../memory/AgentMemories.css";
import "../OpenbotSidebarDeleteDialog.css";
export type SharedTablesProps = {
  agents: readonly { id: string; name: string }[];
  tables: OpenbotSharedTables;
  loading: boolean;
  error: string | null;
  confirmName: string | null;
  deletingName: string | null;
  canDelete: (name: string) => boolean;
  onRequestDelete: (name: string | null) => void;
  onDelete: () => void;
};
export function SharedTablesContent(props: SharedTablesProps) {
  const { scroll } = useSourceScrollFades();
  return (
    <div className="agent-memories-body">
      {props.error && (
        <p className="agent-memory-error" role="alert">
          {props.error}
        </p>
      )}
      {props.loading ? (
        <p className="agent-memory-state">{t("sharedTable.loading")}</p>
      ) : !props.tables.length ? (
        <p className="agent-memory-state">{t("sharedTable.empty")}</p>
      ) : (
        <ul className="shared-table-list" ref={scroll}>
          {props.tables.map((table) => {
            const owner = props.agents.find((agent) => agent.id === table.ownerAgentId);
            return (
              <li className="shared-table-row" key={table.name}>
                <div className="shared-table-main">
                  <span className="shared-table-name">{table.name}</span>
                  <span className="agent-memory-meta">
                    {table.rowCount === null
                      ? t("sharedTable.notCounted")
                      : t("sharedTable.records", { count: table.rowCount })}{" "}
                    ·{" "}
                    {table.ownerAgentId === null
                      ? t("sharedTable.madeOutside")
                      : owner
                        ? t("sharedTable.keptBy", { name: owner.name })
                        : t("sharedTable.keptByDeleted")}
                  </span>
                </div>
                {props.confirmName === table.name ? (
                  <div className="shared-table-confirm">
                    <p>{t("sharedTable.confirmDelete")}</p>
                    <div className="shared-table-confirm-actions">
                      <SourceButton
                        variant="ghost"
                        disabled={props.deletingName === table.name}
                        onClick={() => props.onRequestDelete(null)}
                      >
                        {t("common.cancel")}
                      </SourceButton>
                      <button
                        type="button"
                        className="ui-button ui-button-size-sm ui-button-variant-destructive"
                        disabled={props.deletingName !== null || !props.canDelete(table.name)}
                        onClick={props.onDelete}
                      >
                        {props.deletingName === table.name
                          ? t("common.deleting")
                          : t("common.delete")}
                      </button>
                    </div>
                  </div>
                ) : (
                  props.canDelete(table.name) && (
                    <SourceButton
                      variant="destructive-ghost"
                      className="agent-memory-delete-button"
                      aria-label={t("sharedTable.deleteName", { name: table.name })}
                      disabled={props.deletingName !== null}
                      onClick={() => props.onRequestDelete(table.name)}
                    >
                      <Trash2 />
                    </SourceButton>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
export function SharedTablesModal({
  open,
  onOpenChange,
  ...props
}: SharedTablesProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <div className="openbot-react">
          <Dialog.Backdrop className="ui-dialog-overlay agent-memories-overlay" />
          <Dialog.Popup
            ref={content}
            initialFocus={content}
            className="ui-dialog-content agent-memories-modal"
          >
            <header className="agent-memories-header">
              <div className="agent-memories-heading">
                <Dialog.Title>{t("sharedTable.title")}</Dialog.Title>
                <Dialog.Description className="sr-only">
                  {t("sharedTable.description")}
                </Dialog.Description>
              </div>
              <div className="agent-memories-header-actions">
                <SourceButton
                  variant="ghost"
                  aria-label={t("sharedTable.close")}
                  onClick={() => onOpenChange(false)}
                >
                  <X />
                </SourceButton>
              </div>
            </header>
            <SharedTablesContent {...props} />
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
