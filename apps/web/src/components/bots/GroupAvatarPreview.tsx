import { useState } from "react";
import { Button } from "../ui/button";
import { GroupAvatar } from "./GroupAvatar";

const previewAgents = [
  { id: "preview-design", avatarSeed: "design", avatarHue: 55 },
  { id: "preview-research", avatarSeed: "research", avatarHue: 215 },
  { id: "preview-writing", avatarSeed: "writing", avatarHue: 320 },
  { id: "preview-review", avatarSeed: "review", avatarHue: 150 },
  { id: "preview-planning", avatarSeed: "planning", avatarHue: 30 },
  { id: "preview-build", avatarSeed: "build", avatarHue: 245 },
  { id: "preview-test", avatarSeed: "test", avatarHue: 185 },
];

export function GroupAvatarPreview() {
  const [count, setCount] = useState(4);
  return (
    <section aria-label="Group avatar preview" className="mx-2 mb-4 space-y-2">
      <div className="flex items-center justify-between gap-2 px-2">
        <span className="text-xs font-medium text-muted-foreground">Avatar preview</span>
        <div className="flex gap-0.5" aria-label="Preview member count">
          {([2, 3, 4, 7] as const).map((value) => (
            <Button
              key={value}
              variant={count === value ? "secondary" : "ghost-muted"}
              size="icon-xs"
              aria-label={`Preview ${value} members`}
              aria-pressed={count === value}
              onClick={() => setCount(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex min-h-16 items-center gap-2.5 rounded-lg border border-dashed px-2.5 py-2">
        <div className="flex size-8 shrink-0 items-center justify-center">
          <GroupAvatar
            layout="cluster"
            size={32}
            members={previewAgents.slice(0, count).map((agent) => ({ agentId: agent.id }))}
            agents={previewAgents}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Design team</p>
          <p className="text-xs text-muted-foreground">{count} members · visual preview</p>
        </div>
      </div>
    </section>
  );
}
