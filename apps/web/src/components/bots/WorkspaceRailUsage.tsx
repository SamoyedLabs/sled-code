/* oxlint-disable shadcn/no-unknown-classes -- Account rings use the imported OpenBot rail styles. */
import { useState } from "react";
import { GaugeIcon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { OpenbotAccountUsageRail } from "./upstream/provider/OpenbotAccountUsageRail";
import { Tooltip, TooltipTrigger, TooltipPopup, TooltipProvider } from "./upstream/OpenbotTooltip";
import "./upstream/provider/AccountUsage.css";

export function WorkspaceRailUsage() {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const machine = useLocation({ select: (location) => location.search.machine });
  const selected = environments.find((item) => item.environmentId === machine)?.environmentId;
  const [retained, setRetained] = useState(selected);
  if (selected && selected !== retained) setRetained(selected);
  const environmentId =
    environments.find((item) => item.environmentId === (selected ?? retained))?.environmentId ??
    primary;
  const host = useEnvironmentQuery(
    environmentId ? openbot.status({ environmentId, input: {} }) : null,
  );
  const hostId = host.data?.state === "ready" ? host.data.hostId : null;
  const openUsage = () =>
    void navigate({
      to: "/usage",
      search: { view: "bots", ...(environmentId ? { machine: environmentId } : {}) },
    });
  const fallback = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="workspace-rail-usage-fallback"
            aria-label="Usage"
            onClick={openUsage}
          />
        }
      >
        <GaugeIcon className="size-5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup side="right">Usage</TooltipPopup>
    </Tooltip>
  );
  return (
    <TooltipProvider>
      <div className="openbot-react workspace-rail-usage" aria-label="Provider usage">
        {environmentId && hostId ? (
          <OpenbotAccountUsageRail
            environmentId={environmentId}
            hostId={hostId}
            onOpen={openUsage}
            fallback={fallback}
          />
        ) : (
          fallback
        )}
      </div>
    </TooltipProvider>
  );
}
