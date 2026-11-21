import { useState } from "react";
import {
  FileTextIcon,
  FolderIcon,
  ClockIcon,
  ArrowLeftIcon,
  XIcon,
  CheckIcon,
  MonitorIcon,
  GlobeIcon,
  LockKeyholeIcon,
  PuzzleIcon,
  GitBranchIcon,
  CalendarDaysIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { BotAvatar } from "./avatar/BotAvatar";
import { PreviewAccountUsageDetails } from "./PreviewAccountUsage";
import { T, Var, useGT } from "gt-react";

export type PreviewPage =
  | "Messages"
  | "All tasks"
  | "Routines"
  | "Groups"
  | "Workflows"
  | "Schedule"
  | "Marketplace"
  | "Usage"
  | "Needs attention"
  | "Settings";
export type PreviewTool =
  | "Details"
  | "Files"
  | "Tasks"
  | "Memory"
  | "Browser"
  | "Computer"
  | "Data"
  | "Vault"
  | "Settings";
export const previewBots = [
  {
    id: "agent-8dc30e6d-819c-4165-8ec8-5cb944042c77",
    seed: "first-bot:face:18",
    name: "Luna Scout",
    role: "Research & planning",
    hue: 215,
    preview: "I’ve checked the launch brief.",
    time: "10:42",
  },
  {
    id: "agent-0e11a930-4dd6-4f1f-b9d8-9a52949a10e3",
    seed: "first-bot:face:33",
    name: "Luna Writer",
    role: "Writing & editing",
    hue: 55,
    preview: "Want a more playful version?",
    time: "10:43",
  },
  {
    id: "agent-66f71a7f-347b-4616-91b5-1526a297c8c8",
    seed: "first-bot:face:75",
    name: "Luna",
    role: "Your everyday assistant",
    hue: null,
    preview: "Ready when you are.",
    time: "Yesterday",
  },
] as const;

export function ElementsPreviewSidePanel({
  view,
  onClose,
  onView,
}: {
  view: PreviewTool;
  onClose: () => void;
  onView: (view: PreviewTool) => void;
}) {
  const gt = useGT();
  const [fileOpen, setFileOpen] = useState<string | null>(null);
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l bg-sidebar/30 max-lg:w-64 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:bg-background max-md:shadow-xl"
      aria-label={gt("{view} preview panel", { view })}
    >
      <header className="flex h-13 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-medium">{view}</h2>
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label={gt("Close preview panel")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto p-4 text-sm">
        {view === "Details" && (
          <>
            <section>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                <T>Members · 3</T>
              </h3>
              <div className="space-y-4">
                {previewBots.map((bot) => (
                  <div key={bot.id} className="flex items-center gap-3">
                    <BotAvatar seed={bot.seed} hue={bot.hue} size={32} />
                    <div>
                      <p className="text-xs font-medium">{bot.name}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">{bot.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="border-t pt-4">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                <T>Coordination</T>
              </h3>
              <p className="text-xs leading-relaxed">
                <T>
                  Luna Scout routes requests to the right bot. You can also choose a recipient in
                  the composer.
                </T>
              </p>
            </section>
            <section className="border-t pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground">
                  <T>Shared files</T>
                </h3>
                <Button variant="ghost-muted" size="xs" onClick={() => onView("Files")}>
                  <T>View all</T>
                </Button>
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md border p-3 text-left text-xs hover:bg-accent"
                onClick={() => onView("Files")}
              >
                <FileTextIcon className="size-4 text-muted-foreground" />
                <span>launch-brief.md</span>
              </button>
            </section>
            <section className="border-t pt-4">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                <T>Current task</T>
              </h3>
              <button
                type="button"
                className="w-full rounded-md border p-3 text-left text-xs hover:bg-accent"
                onClick={() => onView("Tasks")}
              >
                <span className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 text-success" />
                  <T>Draft launch headline</T>
                </span>
                <span className="mt-2 block text-2xs text-muted-foreground">
                  <T>Luna Writer · Ready for review</T>
                </span>
              </button>
            </section>
          </>
        )}
        {view === "Files" && (
          <>
            <p className="text-xs text-muted-foreground">
              <T>Sample shared files</T>
            </p>
            {["launch-brief.md", "product-notes.md", "headline-options.md"].map((name, i) => (
              <button
                key={name}
                type="button"
                className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent"
                onClick={() => setFileOpen(fileOpen === name ? null : name)}
              >
                <FileTextIcon className="size-5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{name}</span>
                  <span className="mt-1 block text-2xs text-muted-foreground">
                    <T>
                      <Var>{i + 1}</Var> KB · Today
                    </T>
                  </span>
                </span>
              </button>
            ))}
            {fileOpen && (
              <article className="rounded-md border bg-card p-3 text-xs leading-relaxed">
                <h3 className="mb-2 font-medium">
                  <T>
                    <Var>{fileOpen}</Var> · sample
                  </T>
                </h3>
                <p>
                  <T>Audience: people choosing their next phone.</T>
                </p>
                <p className="mt-2">
                  <T>Tone: clear, confident, and warm. Verify product claims before publishing.</T>
                </p>
              </article>
            )}
          </>
        )}
        {view === "Tasks" && (
          <>
            <p className="text-xs text-muted-foreground">
              <T>Sample task list</T>
            </p>
            {["Review product notes", "Draft launch headline", "Refine the final copy"].map(
              (name, i) => (
                <div key={name} className="rounded-lg border p-3">
                  <p className="flex items-center gap-2 text-xs font-medium">
                    {i < 2 ? (
                      <CheckIcon className="size-3.5 text-success" />
                    ) : (
                      <ClockIcon className="size-3.5 text-muted-foreground" />
                    )}
                    {name}
                  </p>
                  <p className="mt-2 text-2xs text-muted-foreground">
                    {i < 2 ? gt("Ready for review") : gt("Queued")} ·{" "}
                    {i === 0 ? gt("Luna Scout") : gt("Luna Writer")}
                  </p>
                </div>
              ),
            )}
          </>
        )}
        {view === "Memory" && (
          <>
            <p className="text-xs text-muted-foreground">
              <T>Sample saved context</T>
            </p>
            <article className="rounded-md border p-3 text-xs leading-relaxed">
              <T>Keep copy concise, avoid hype, and check factual claims.</T>
              <span className="mt-3 block text-2xs text-muted-foreground">
                <T>Group preference</T>
              </span>
            </article>
          </>
        )}
        {(view === "Browser" || view === "Computer") && (
          <>
            <div className="flex aspect-video items-center justify-center rounded-lg border bg-muted/30">
              {view === "Browser" ? (
                <GlobeIcon className="size-8 text-muted-foreground" />
              ) : (
                <MonitorIcon className="size-8 text-muted-foreground" />
              )}
            </div>
            <h3 className="text-sm font-medium">{view} workspace</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <T>
                The live viewer belongs here. This frontend preview shows its placement without
                connecting to a browser or desktop.
              </T>
            </p>
          </>
        )}
        {view === "Data" && (
          <>
            <p className="text-xs text-muted-foreground">
              <T>Sample workspace storage</T>
            </p>
            {["Files · 3 items", "Memories · 1 item", "Conversations · 4"].map((text) => (
              <div key={text} className="flex items-center gap-2 rounded-md border p-3 text-xs">
                <FolderIcon className="size-4 text-muted-foreground" />
                {text}
              </div>
            ))}
          </>
        )}
        {view === "Vault" && (
          <>
            <LockKeyholeIcon className="size-6 text-muted-foreground" />
            <h3 className="font-medium">
              <T>Secure items</T>
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <T>
                Saved credentials and protected responses appear here. No credentials are loaded
                into this preview.
              </T>
            </p>
          </>
        )}
        {view === "Settings" && (
          <>
            <h3 className="text-xs font-medium text-muted-foreground">
              <T>Conversation settings</T>
            </h3>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium">
                <T>Launch copy</T>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                <T>Three bots working together on one brief.</T>
              </p>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>
                <T>Default coordinator</T>
              </span>
              <span className="text-muted-foreground">
                <T>Luna Scout</T>
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>
                <T>Model</T>
              </span>
              <span className="text-muted-foreground">
                <T>Codex Luna</T>
              </span>
            </div>
          </>
        )}
      </div>
      <p className="border-t px-4 py-3 text-2xs text-muted-foreground">
        <T>Frontend sample</T>
      </p>
    </aside>
  );
}

export function ElementsPreviewPage({
  page,
  onBack,
}: {
  page: Exclude<PreviewPage, "Messages">;
  onBack: () => void;
}) {
  const gt = useGT();
  const [routine, setRoutine] = useState(true);
  return (
    <main className="flex min-w-0 flex-1 flex-col" aria-label={gt("{page} preview page", { page })}>
      <header className="flex h-13 shrink-0 items-center gap-3 border-b px-5">
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label={gt("Back to preview messages")}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="text-sm font-medium">{page}</h1>
        <span className="ml-auto text-2xs text-muted-foreground">
          <T>Frontend sample</T>
        </span>
      </header>
      <div className="mx-auto w-full max-w-4xl space-y-6 overflow-y-auto p-8">
        <p className="text-sm text-muted-foreground">
          {page === "All tasks"
            ? gt("Work across your bots, in one place.")
            : page === "Routines"
              ? gt("Recurring work, without repeating yourself.")
              : page === "Settings"
                ? gt("Your workspace, the way you like it.")
                : gt("{page} for your bot workspace.", { page })}
        </p>
        {page === "All tasks" && (
          <>
            <nav className="flex gap-6 border-b pb-3 text-xs">
              <span className="font-medium">
                <T>All tasks</T>
              </span>
              <span className="text-muted-foreground">
                <T>In progress</T>
              </span>
              <span className="text-muted-foreground">
                <T>Completed</T>
              </span>
            </nav>
            {["Draft launch headline", "Review product notes", "Prepare a short summary"].map(
              (name, i) => (
                <div key={name} className="flex items-center gap-4 rounded-lg border p-4">
                  <BotAvatar seed={previewBots[i]!.seed} hue={previewBots[i]!.hue} size={32} />
                  <div className="flex-1">
                    <h2 className="text-sm font-medium">{name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <T>
                        <Var>{previewBots[i]!.name}</Var> · Launch copy
                      </T>
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {i < 2 ? gt("Ready for review") : gt("Queued")}
                  </span>
                </div>
              ),
            )}
          </>
        )}
        {page === "Routines" && (
          <div className="flex items-center gap-4 rounded-lg border p-5">
            <CalendarDaysIcon className="size-5 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="text-sm font-medium">
                <T>Morning brief</T>
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                <T>Luna Scout · Weekdays at 9:00 AM</T>
              </p>
            </div>
            <Switch
              checked={routine}
              onCheckedChange={setRoutine}
              aria-label={gt("Sample morning brief routine")}
            />
          </div>
        )}
        {page === "Groups" && (
          <div className="rounded-lg border p-5">
            <div className="mb-4 flex gap-2">
              {previewBots.map((bot) => (
                <BotAvatar key={bot.id} seed={bot.seed} hue={bot.hue} size={32} />
              ))}
            </div>
            <h2 className="text-sm font-medium">
              <T>Launch copy</T>
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              <T>Three bots · coordinated by Luna Scout</T>
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
              <T>Open conversation</T>
            </Button>
          </div>
        )}
        {page === "Workflows" && (
          <div className="rounded-lg border p-5">
            <GitBranchIcon className="mb-3 size-5 text-muted-foreground" />
            <h2 className="text-sm font-medium">
              <T>Brief → research → draft</T>
            </h2>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {["Read brief", "Verify facts", "Write copy"].map((name, i) => (
                <div key={name} className="rounded-md border bg-muted/30 p-4 text-xs">
                  <span className="mb-3 block text-2xs text-muted-foreground">
                    <T>
                      Step <Var>{i + 1}</Var>
                    </T>
                  </span>
                  {name}
                </div>
              ))}
            </div>
          </div>
        )}
        {page === "Schedule" && (
          <div className="rounded-lg border p-5">
            <h2 className="mb-5 text-sm font-medium">
              <T>This week</T>
            </h2>
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => (
              <div key={day} className="flex gap-6 border-t py-4 text-xs">
                <span className="w-24 text-muted-foreground">{day}</span>
                <span>
                  <T>9:00 AM</T>
                </span>
                <span className="font-medium">
                  <T>Morning brief</T>
                </span>
              </div>
            ))}
          </div>
        )}
        {page === "Marketplace" && (
          <div className="grid gap-4 sm:grid-cols-2">
            {["Writing toolkit", "Research essentials", "Browser workflows", "Workspace files"].map(
              (name) => (
                <div key={name} className="rounded-lg border p-5">
                  <PuzzleIcon className="mb-4 size-5 text-muted-foreground" />
                  <h2 className="text-sm font-medium">{name}</h2>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <T>Example catalog entry</T>
                  </p>
                </div>
              ),
            )}
          </div>
        )}
        {page === "Usage" && <PreviewAccountUsageDetails />}
        {page === "Needs attention" && (
          <div className="rounded-lg border p-5">
            <h2 className="text-sm font-medium">
              <T>Review launch copy</T>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              <T>Luna Writer has a headline ready for your feedback.</T>
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
              <T>Open conversation</T>
            </Button>
          </div>
        )}
        {page === "Settings" && (
          <>
            <h2 className="text-xs font-medium text-muted-foreground">
              <T>Workspace</T>
            </h2>
            {[
              ["Appearance", "Follow system"],
              ["Default model", "Codex Luna"],
              ["Notifications", "On"],
              ["Hosting", "Optional on this device"],
            ].map(([name, value]) => (
              <div key={name} className="flex items-center justify-between border-b py-4 text-sm">
                <span>{name}</span>
                <span className="text-muted-foreground">{value}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
