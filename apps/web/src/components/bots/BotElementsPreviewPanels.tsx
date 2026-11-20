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
  const [fileOpen, setFileOpen] = useState<string | null>(null);
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l bg-sidebar/30 max-lg:w-64 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:bg-background max-md:shadow-xl"
      aria-label={`${view} preview panel`}
    >
      <header className="flex h-13 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-medium">{view}</h2>
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label="Close preview panel"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto p-4 text-sm">
        {view === "Details" && (
          <>
            <section>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">Members · 3</h3>
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
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Coordination</h3>
              <p className="text-xs leading-relaxed">
                Luna Scout routes requests to the right bot. You can also choose a recipient in the
                composer.
              </p>
            </section>
            <section className="border-t pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground">Shared files</h3>
                <Button variant="ghost-muted" size="xs" onClick={() => onView("Files")}>
                  View all
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
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Current task</h3>
              <button
                type="button"
                className="w-full rounded-md border p-3 text-left text-xs hover:bg-accent"
                onClick={() => onView("Tasks")}
              >
                <span className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 text-success" />
                  Draft launch headline
                </span>
                <span className="mt-2 block text-2xs text-muted-foreground">
                  Luna Writer · Ready for review
                </span>
              </button>
            </section>
          </>
        )}
        {view === "Files" && (
          <>
            <p className="text-xs text-muted-foreground">Sample shared files</p>
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
                    {i + 1} KB · Today
                  </span>
                </span>
              </button>
            ))}
            {fileOpen && (
              <article className="rounded-md border bg-card p-3 text-xs leading-relaxed">
                <h3 className="mb-2 font-medium">{fileOpen} · sample</h3>
                <p>Audience: people choosing their next phone.</p>
                <p className="mt-2">
                  Tone: clear, confident, and warm. Verify product claims before publishing.
                </p>
              </article>
            )}
          </>
        )}
        {view === "Tasks" && (
          <>
            <p className="text-xs text-muted-foreground">Sample task list</p>
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
                    {i < 2 ? "Ready for review" : "Queued"} ·{" "}
                    {i === 0 ? "Luna Scout" : "Luna Writer"}
                  </p>
                </div>
              ),
            )}
          </>
        )}
        {view === "Memory" && (
          <>
            <p className="text-xs text-muted-foreground">Sample saved context</p>
            <article className="rounded-md border p-3 text-xs leading-relaxed">
              Keep copy concise, avoid hype, and check factual claims.
              <span className="mt-3 block text-2xs text-muted-foreground">Group preference</span>
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
              The live viewer belongs here. This frontend preview shows its placement without
              connecting to a browser or desktop.
            </p>
          </>
        )}
        {view === "Data" && (
          <>
            <p className="text-xs text-muted-foreground">Sample workspace storage</p>
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
            <h3 className="font-medium">Secure items</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Saved credentials and protected responses appear here. No credentials are loaded into
              this preview.
            </p>
          </>
        )}
        {view === "Settings" && (
          <>
            <h3 className="text-xs font-medium text-muted-foreground">Conversation settings</h3>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium">Launch copy</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Three bots working together on one brief.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>Default coordinator</span>
              <span className="text-muted-foreground">Luna Scout</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>Model</span>
              <span className="text-muted-foreground">Codex Luna</span>
            </div>
          </>
        )}
      </div>
      <p className="border-t px-4 py-3 text-2xs text-muted-foreground">Frontend sample</p>
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
  const [routine, setRoutine] = useState(true);
  return (
    <main className="flex min-w-0 flex-1 flex-col" aria-label={`${page} preview page`}>
      <header className="flex h-13 shrink-0 items-center gap-3 border-b px-5">
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label="Back to preview messages"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="text-sm font-medium">{page}</h1>
        <span className="ml-auto text-2xs text-muted-foreground">Frontend sample</span>
      </header>
      <div className="mx-auto w-full max-w-4xl space-y-6 overflow-y-auto p-8">
        <p className="text-sm text-muted-foreground">
          {page === "All tasks"
            ? "Work across your bots, in one place."
            : page === "Routines"
              ? "Recurring work, without repeating yourself."
              : page === "Settings"
                ? "Your workspace, the way you like it."
                : `${page} for your bot workspace.`}
        </p>
        {page === "All tasks" && (
          <>
            <nav className="flex gap-6 border-b pb-3 text-xs">
              <span className="font-medium">All tasks</span>
              <span className="text-muted-foreground">In progress</span>
              <span className="text-muted-foreground">Completed</span>
            </nav>
            {["Draft launch headline", "Review product notes", "Prepare a short summary"].map(
              (name, i) => (
                <div key={name} className="flex items-center gap-4 rounded-lg border p-4">
                  <BotAvatar seed={previewBots[i]!.seed} hue={previewBots[i]!.hue} size={32} />
                  <div className="flex-1">
                    <h2 className="text-sm font-medium">{name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {previewBots[i]!.name} · Launch copy
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {i < 2 ? "Ready for review" : "Queued"}
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
              <h2 className="text-sm font-medium">Morning brief</h2>
              <p className="mt-1 text-xs text-muted-foreground">Luna Scout · Weekdays at 9:00 AM</p>
            </div>
            <Switch
              checked={routine}
              onCheckedChange={setRoutine}
              aria-label="Sample morning brief routine"
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
            <h2 className="text-sm font-medium">Launch copy</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Three bots · coordinated by Luna Scout
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
              Open conversation
            </Button>
          </div>
        )}
        {page === "Workflows" && (
          <div className="rounded-lg border p-5">
            <GitBranchIcon className="mb-3 size-5 text-muted-foreground" />
            <h2 className="text-sm font-medium">Brief → research → draft</h2>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {["Read brief", "Verify facts", "Write copy"].map((name, i) => (
                <div key={name} className="rounded-md border bg-muted/30 p-4 text-xs">
                  <span className="mb-3 block text-2xs text-muted-foreground">Step {i + 1}</span>
                  {name}
                </div>
              ))}
            </div>
          </div>
        )}
        {page === "Schedule" && (
          <div className="rounded-lg border p-5">
            <h2 className="mb-5 text-sm font-medium">This week</h2>
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => (
              <div key={day} className="flex gap-6 border-t py-4 text-xs">
                <span className="w-24 text-muted-foreground">{day}</span>
                <span>9:00 AM</span>
                <span className="font-medium">Morning brief</span>
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
                  <p className="mt-2 text-xs text-muted-foreground">Example catalog entry</p>
                </div>
              ),
            )}
          </div>
        )}
        {page === "Usage" && <PreviewAccountUsageDetails />}
        {page === "Needs attention" && (
          <div className="rounded-lg border p-5">
            <h2 className="text-sm font-medium">Review launch copy</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Luna Writer has a headline ready for your feedback.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
              Open conversation
            </Button>
          </div>
        )}
        {page === "Settings" && (
          <>
            <h2 className="text-xs font-medium text-muted-foreground">Workspace</h2>
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
