import { useState } from "react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../ui/dialog";
import { Button } from "../../../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";
import type { MarketplaceAgent } from "./marketplace-model";
import { T, useGT } from "gt-react";

export interface MarketplaceDraftRequest {
  readonly title: string;
  readonly text: string;
  readonly agentIds?: readonly string[];
}
export function MarketplaceDraftDialog({
  request,
  agents,
  activeAgentId,
  onClose,
  onCompose,
}: {
  request: MarketplaceDraftRequest;
  agents: readonly MarketplaceAgent[];
  activeAgentId?: string | undefined;
  onClose: () => void;
  onCompose: (agentId: string, text: string) => boolean;
}) {
  const gt = useGT();
  const choices = agents.filter(
    (agent) => !request.agentIds || request.agentIds.includes(agent.id),
  );
  const [agentId, setAgentId] = useState(
    () => choices.find((agent) => agent.id === activeAgentId)?.id ?? choices[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    if (!choices.some((agent) => agent.id === agentId)) return;
    if (onCompose(agentId, request.text)) onClose();
    else
      setError(
        gt(
          "The selected host or session changed. Reopen the Marketplace before adding this draft.",
        ),
      );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>
            <T>Add this to a bot’s main-chat draft. Your existing text is kept; nothing is sent.</T>
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2 text-sm">
          <T>Bot</T>
          <Select value={agentId} onValueChange={(value) => setAgentId(value ?? "")}>
            <SelectTrigger aria-label={gt("Draft bot")}>
              <SelectValue>
                {choices.find((agent) => agent.id === agentId)?.name ?? gt("Choose a bot")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {choices.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button disabled={!choices.some((agent) => agent.id === agentId)} onClick={add}>
            <T>Add to draft</T>
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
