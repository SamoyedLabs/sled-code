import { botMemoryRows, botSubagentRows } from "./bot-message-notes";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { useBotPalette } from "./upstream/BotChrome";
import { useBotMessageDetail, type BotMessageDetailScope } from "./useBotMessageDetail";

const memoryActions = {
  saved: "saved",
  updated: "updated",
  forgotten: "forgotten",
  notChanged: "unchanged",
} as const;

type Memory = ReturnType<typeof botMemoryRows>[number];
type Worker = ReturnType<typeof botSubagentRows>[number];
const stepSymbols: Record<Worker["steps"][number]["kind"], AppSymbolName> = {
  thinking: "sparkles",
  text: "text.bubble",
  search: "magnifyingglass",
  read: "doc",
  edit: "pencil",
  command: "terminal",
  web: "globe",
  tool: "gearshape",
};

export function BotMessageNotes({
  scope,
  memories: memorySummaryRows,
  workers: workerSummaryRows,
  deferredMemory,
  deferredWorkers,
  agentName,
}: {
  scope: BotMessageDetailScope;
  memories: readonly Memory[];
  workers: readonly Worker[];
  deferredMemory: boolean;
  deferredWorkers: boolean;
  agentName?: string;
}) {
  const p = useBotPalette();
  const [open, setOpen] = useState<"memory" | "workers" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useBotMessageDetail(scope);
  const workers =
    open === "workers" && detail.phase === "ready"
      ? botSubagentRows(detail.data)
      : workerSummaryRows;
  const memories =
    open === "memory" && detail.phase === "ready" ? botMemoryRows(detail.data) : memorySummaryRows;
  const selected = workers.find((item) => item.id === selectedId);
  const busy = workers.filter((item) => item.status === "running").length;
  const completed = workers.filter((item) => item.status === "completed").length;
  const [now, setNow] = useState(Date.now);
  const live = open === "workers" && busy > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The open sheet reads elapsed runtime only while it has a running bot.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live]);
  const memorySummary = Object.entries(memoryActions)
    .flatMap(([action, label]) => {
      const count = memories.filter((item) => item.action === action).length;
      return count ? [`${count} ${label}`] : [];
    })
    .join(" · ");
  const close = () => {
    setOpen(null);
    setSelectedId(null);
    detail.clear();
  };
  const reveal = (kind: "memory" | "workers") => {
    setOpen(kind);
    if (kind === "memory" ? deferredMemory : deferredWorkers)
      void detail.load(kind === "memory" ? "memoryChanges" : "subagents");
  };
  return (
    <>
      {(workers.length > 0 || deferredWorkers) && (
        <NoteRow
          label={
            workers.length
              ? `${workers.length} ${workers.length === 1 ? "subagent" : "subagents"} · ${busy ? `${busy} running` : `${completed} completed`}`
              : "Subagents"
          }
          onPress={() => reveal("workers")}
        />
      )}
      {(memories.length > 0 || deferredMemory) && (
        <NoteRow
          label={memorySummary ? `Memory: ${memorySummary}` : "Memory changes"}
          onPress={() => reveal("memory")}
        />
      )}
      {open && (
        <Sheet
          title={open === "memory" ? "Memory changes" : selected?.title || "Subagents"}
          onClose={close}
        >
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-3 px-5 py-4"
          >
            {detail.phase === "loading" && <Text accessibilityRole="status">Loading details…</Text>}
            {detail.phase === "error" && (
              <NoteRow label="Could not load details. Tap to retry." onPress={() => reveal(open)} />
            )}
            {detail.phase === "ready" &&
              !(open === "memory" ? memories.length : workers.length) && (
                <Text className="text-foreground-muted">No details were returned.</Text>
              )}
            {open === "memory" ? (
              <>
                {!!memorySummary && <Text style={{ color: p.muted }}>{memorySummary}</Text>}
                {memories.map((change, index) => (
                  <View
                    key={JSON.stringify([change.memoryId, index])}
                    className="gap-1 rounded-xl bg-grouped-card px-4 py-3"
                  >
                    <Text className="font-t3-medium">{memoryActions[change.action]}</Text>
                    {change.previousText !== undefined && (
                      <Text selectable className="text-foreground-muted line-through">
                        {change.previousText}
                      </Text>
                    )}
                    <Text
                      selectable
                      className={
                        change.action === "forgotten"
                          ? "text-foreground-muted line-through"
                          : undefined
                      }
                    >
                      {change.text}
                    </Text>
                  </View>
                ))}
              </>
            ) : selected ? (
              <>
                <NoteRow label="All subagents" onPress={() => setSelectedId(null)} />
                <Text accessibilityRole="header" className="text-lg font-t3-semibold" selectable>
                  {selected.title}
                </Text>
                <Text className="text-foreground-muted">
                  {[
                    selected.agentType,
                    workerState(selected, now),
                    selected.background && "Background",
                    `${selected.steps.length} steps`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {selected.prompt && (
                  <View className="gap-1 rounded-xl bg-grouped-card px-4 py-3">
                    <Text className="text-xs text-foreground-muted">
                      {agentName ? `Task from ${agentName}` : "Task"}
                    </Text>
                    <Text selectable>{selected.prompt}</Text>
                  </View>
                )}
                {selected.error && <Text className="text-danger-foreground">{selected.error}</Text>}
                {selected.steps.map((step) => (
                  <View
                    key={step.id}
                    className="flex-row gap-3 rounded-xl bg-grouped-card px-4 py-3"
                  >
                    <SymbolView name={stepSymbols[step.kind]} size={16} tintColor={p.muted} />
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="font-t3-medium">
                        {step.kind === "thinking" ? "Thinking" : step.kind}
                      </Text>
                      {step.kind !== "thinking" && (
                        <Text
                          selectable
                          style={{ fontFamily: step.kind === "command" ? "Menlo" : undefined }}
                        >
                          {step.text}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </>
            ) : (
              workers.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  className="gap-1 rounded-xl bg-grouped-card px-4 py-3"
                  onPress={() => setSelectedId(item.id)}
                >
                  <Text className="font-t3-medium">{item.title || "Subagent"}</Text>
                  <Text style={{ color: p.muted }}>{workerState(item, now)}</Text>
                  {lastWorkerStep(item) && <Text numberOfLines={2}>{lastWorkerStep(item)}</Text>}
                </Pressable>
              ))
            )}
          </ScreenScrollView>
        </Sheet>
      )}
    </>
  );
}

function workerState(item: Worker, now: number) {
  const end = item.endedAt ? Date.parse(item.endedAt) : item.status === "running" ? now : NaN;
  const seconds = Math.round((end - Date.parse(item.startedAt)) / 1_000);
  return Number.isFinite(seconds) && seconds >= 0 ? `${item.status} · ${seconds}s` : item.status;
}

function lastWorkerStep(item: Worker) {
  const step = item.steps.at(-1);
  return step?.kind === "thinking" ? "Thinking" : step?.text;
}

function NoteRow({ label, onPress }: { label: string; onPress: () => void }) {
  const p = useBotPalette();
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-8 flex-row items-center gap-1 self-start"
      onPress={onPress}
    >
      <Text style={{ color: p.muted, fontSize: 13 }}>{label}</Text>
      <SymbolView name="chevron.right" size={12} tintColor={p.muted} />
    </Pressable>
  );
}
