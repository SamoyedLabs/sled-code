/* oxlint-disable shadcn/no-unknown-classes -- Imported source styles supply openbot-react. */
import { useState } from "react";
import type { DataActions } from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../ui/button";
import { useBotData } from "./useBotData";
import {
  SharedTablesContent,
  SharedTablesModal,
  type SharedTablesProps,
} from "../bots/upstream/data/SharedTables";
import { HostedSites } from "../bots/upstream/data/HostedSites";

type Props = {
  actions: DataActions;
  agents: readonly { id: string; name: string }[];
  workspace?: boolean;
  view?: "tables" | "sites" | undefined;
  modal?: { open: boolean; onOpenChange: (open: boolean) => void } | undefined;
};
export function BotData({ workspace = false, ...props }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      aria-label={props.view === "sites" ? "Published sites" : "Tables"}
      className="openbot-react min-w-0"
    >
      {!workspace && !props.modal && (
        <Button variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {props.view === "sites" ? "Published sites" : "Tables"}
        </Button>
      )}
      {(workspace || expanded || props.modal?.open) && <DataPanel {...props} />}
    </section>
  );
}
function DataPanel({ actions, agents, view = "tables", modal }: Props) {
  const data = useBotData(actions);
  const tableProps: SharedTablesProps = {
    agents,
    tables: actions.canReadTables ? (data.tables ?? []) : [],
    loading: data.tables === null && data.busy,
    error: actions.canReadTables
      ? data.errors.tables
      : "You don’t have permission to view tables on this host.",
    confirmName: data.pending?.operation === "tables.delete" ? data.pending.name : null,
    deletingName:
      data.busy && data.pending?.operation === "tables.delete" ? data.pending.name : null,
    canDelete: (name) => actions.canDelete({ operation: "tables.delete", name }),
    onRequestDelete: (name) =>
      data.setPending(name === null ? null : { operation: "tables.delete", name }),
    onDelete: data.confirmDelete,
  };
  if (view === "sites")
    return (
      <HostedSites
        sites={actions.canReadSites ? data.sites : null}
        available={actions.canReadSites}
        busy={data.busy}
        error={data.errors.sites}
        pendingId={data.pending?.operation === "sites.delete" ? data.pending.siteId : null}
        canDelete={(siteId) => actions.canDelete({ operation: "sites.delete", siteId })}
        onDelete={(siteId) =>
          data.setPending(siteId === null ? null : { operation: "sites.delete", siteId })
        }
        onConfirmDelete={data.confirmDelete}
      />
    );
  return modal ? (
    <SharedTablesModal {...tableProps} {...modal} />
  ) : (
    <SharedTablesContent {...tableProps} />
  );
}
