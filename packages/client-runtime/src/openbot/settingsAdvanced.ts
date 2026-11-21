import type { Json } from "effect/Schema";
import { settingRecord, settingRequest } from "./settings.ts";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import { mFallback, msg } from "gt-i18n";
export type SettingControl = {
  readonly id: string;
  readonly kind: "text" | "input" | "button";
  readonly label: string;
  readonly value?: string;
  readonly inputKey?: string;
  readonly request?: OpenbotSettingsRequest | null;
  readonly confirm?: boolean;
};
export type SettingSection = {
  readonly id: string;
  readonly title: string;
  readonly controls: readonly SettingControl[];
};
export function settingsAdvanced(
  agentId: string | undefined,
  capabilities: readonly string[],
  values: Readonly<Record<string, Json>>,
  drafts: Readonly<Record<string, string>>,
): readonly SettingSection[] {
  const sections: SettingSection[] = [];
  const has = (id: string) => capabilities.includes(`${id}-v1`);
  const value = (op: string) => values[`latest:${op.split(".")[1]}`] ?? values[op];
  const button = (
    id: string,
    label: string,
    operation: OpenbotSettingsRequest["operation"],
    parameters: Json,
    confirm = false,
  ): SettingControl => ({
    id,
    kind: "button",
    label,
    request: settingRequest(operation, parameters),
    confirm,
  });
  const input = (key: string, label: string): SettingControl => ({
    id: key,
    kind: "input",
    label,
    inputKey: key,
    value: drafts[key] ?? "",
  });
  const text = (id: string, label: string): SettingControl => ({ id, kind: "text", label });
  const rows = (input: unknown): readonly Record<string, Json>[] =>
    Array.isArray(input) ? input.map(settingRecord) : [];
  if (has("storage") || has("storage-disk")) {
    const controls: SettingControl[] = [];
    const bytes = (value: Json | undefined) =>
      typeof value === "number" ? `${(value / (1024 * 1024)).toFixed(1)} MiB` : "unknown";
    if (has("storage-disk")) {
      controls.push(button("disk", "Read host disk space", "settings.storage.disk", {}));
      const disk = settingRecord(values["settings.storage.disk"]);
      if (disk.totalBytes !== undefined)
        controls.push(text("space", `${bytes(disk.freeBytes)} free of ${bytes(disk.totalBytes)}`));
    }
    if (has("storage")) {
      controls.push(
        button(
          "usage",
          agentId ? "Scan this agent's chat files" : "Scan host storage",
          "settings.storage.usage",
          agentId ? { scope: "agent", agentId } : { scope: "host" },
        ),
      );
      const latest = settingRecord(values["settings.storage.usage"]);
      const data = agentId
        ? latest.scope === "agent" && latest.agentId === agentId
          ? latest
          : {}
        : latest.scope === "host"
          ? latest
          : {};
      for (const category of rows(data.breakdown))
        controls.push(
          text(String(category.category), `${String(category.category)}: ${bytes(category.bytes)}`),
        );
      const files = rows(data.files);
      const offset = Math.max(0, Number(drafts.storageOffset) || 0);
      for (const file of files.slice(offset, offset + 25)) {
        controls.push(
          text(
            String(file.id),
            `${String(file.name)} · ${bytes(file.size)} · ${String(file.status)}`,
          ),
        );
        if (typeof file.id === "string" && file.deletable === true && file.status === "available")
          controls.push(
            button(
              `delete:${file.id}`,
              `Delete stored file ${String(file.name)}`,
              "settings.storage.deleteFile",
              { fileId: file.id },
              true,
            ),
          );
      }
      if (offset > 0)
        controls.push({
          id: "previous",
          kind: "button",
          label: mFallback(msg("Previous 25 files")),
          inputKey: "storageOffset",
          value: String(Math.max(0, offset - 25)),
        });
      if (offset + 25 < files.length)
        controls.push({
          id: "next",
          kind: "button",
          label: mFallback(msg("Next 25 files")),
          inputKey: "storageOffset",
          value: String(offset + 25),
        });
      if (data.truncated === true)
        controls.push(
          text(
            "truncated",
            "The host returned a bounded file list. Select an agent to narrow the scan.",
          ),
        );
      controls.push(
        text(
          "deletion",
          "Deletion removes stored chat file bytes on this host. Refresh the scan after a change.",
        ),
      );
    }
    sections.push({ id: "storage", title: mFallback(msg("Host storage")), controls });
  }
  if (capabilities.includes("conversation-unread")) {
    const reads = settingRecord(values["settings.conversation-reads.read"]);
    const entries = Object.entries(reads).filter(([id]) => !agentId || id === agentId);
    const offset = Math.max(0, Number(drafts.readsOffset) || 0);
    const controls: SettingControl[] = [
      button("refresh", "Refresh unread counts", "settings.conversation-reads.read", {}),
    ];
    for (const [id, value] of entries.slice(offset, offset + 25)) {
      const read = settingRecord(value);
      controls.push(
        text(
          id,
          `${id}: ${String(read.unreadCount)} unread · last read ${String(read.throughMessageId ?? "none")}`,
        ),
      );
    }
    if (offset > 0)
      controls.push({
        id: "previous",
        kind: "button",
        label: mFallback(msg("Previous 25 agents")),
        inputKey: "readsOffset",
        value: String(Math.max(0, offset - 25)),
      });
    if (offset + 25 < entries.length)
      controls.push({
        id: "next",
        kind: "button",
        label: mFallback(msg("Next 25 agents")),
        inputKey: "readsOffset",
        value: String(offset + 25),
      });
    sections.push({
      id: "conversation-reads",
      title: mFallback(msg("Conversation read states")),
      controls,
    });
  }
  if (has("sidebar-folders")) {
    const data = settingRecord(value("settings.sidebar-folders.read"));
    const folders = rows(data.sections);
    const parent = folders.find((folder) => folder.id === drafts.sidebarParent);
    const parentIsBelow = (sectionId: string) => {
      let current = parent;
      const seen = new Set<string>();
      while (current && typeof current.id === "string" && !seen.has(current.id)) {
        if (current.id === sectionId) return true;
        seen.add(current.id);
        current = folders.find((folder) => folder.id === current?.parentId);
      }
      return false;
    };
    const controls: SettingControl[] = [
      button("read", "Refresh sidebar folders", "settings.sidebar-folders.read", {}),
      input("sidebarName", "Folder name"),
    ];
    if (drafts.sidebarName?.trim())
      controls.push(
        button("create", "Create top-level folder", "settings.sidebar-folders.actions", {
          type: "create",
          name: drafts.sidebarName.trim(),
          ...(agentId ? { agentId } : {}),
        }),
      );
    if (parent && drafts.sidebarName?.trim())
      controls.push(
        button(
          "create-child",
          `Create folder inside ${String(parent.name)}`,
          "settings.sidebar-folders.actions",
          { type: "create", name: drafts.sidebarName.trim(), parentId: parent.id! },
        ),
      );
    for (const folder of folders)
      if (typeof folder.id === "string") {
        controls.push({
          id: `parent:${folder.id}`,
          kind: "button",
          label: mFallback(
            msg("Use {String} as destination folder", { String: String(folder.name) }),
          ),
          inputKey: "sidebarParent",
          value: folder.id,
        });
        if (parent && typeof parent.id === "string" && !parentIsBelow(folder.id))
          controls.push(
            button(
              `nest:${folder.id}`,
              `Move ${String(folder.name)} inside ${String(parent.name)}`,
              "settings.sidebar-folders.actions",
              { type: "nest", sectionId: folder.id, parentId: parent.id, beforeSectionId: null },
              true,
            ),
          );
        controls.push(
          text(
            folder.id,
            `${String(folder.name)}${folder.parentId ? ` · inside ${String(folder.parentId)}` : ""}`,
          ),
        );
        if (drafts.sidebarName?.trim())
          controls.push(
            button(
              `rename:${folder.id}`,
              `Rename ${String(folder.name)} to entered name`,
              "settings.sidebar-folders.actions",
              { type: "rename", sectionId: folder.id, name: drafts.sidebarName.trim() },
              true,
            ),
          );
        controls.push(
          button(
            `up:${folder.id}`,
            `Move ${String(folder.name)} up`,
            "settings.sidebar-folders.actions",
            { type: "move", sectionId: folder.id, direction: "up" },
          ),
          button(
            `down:${folder.id}`,
            `Move ${String(folder.name)} down`,
            "settings.sidebar-folders.actions",
            { type: "move", sectionId: folder.id, direction: "down" },
          ),
          button(
            `delete:${folder.id}`,
            `Delete ${String(folder.name)}`,
            "settings.sidebar-folders.actions",
            { type: "delete", sectionId: folder.id },
            true,
          ),
        );
        if (agentId)
          controls.push(
            button(
              `assign:${folder.id}`,
              `Put this agent in ${String(folder.name)}`,
              "settings.sidebar-folders.actions",
              { type: "assign", agentId, sectionId: folder.id },
            ),
          );
        if (folder.parentId)
          controls.push(
            button(
              `unnest:${folder.id}`,
              `Move ${String(folder.name)} to top level`,
              "settings.sidebar-folders.actions",
              { type: "nest", sectionId: folder.id, parentId: null, beforeSectionId: null },
            ),
          );
      }
    if (agentId && data.revision !== undefined)
      controls.push(
        button(
          "unassign",
          "Remove this agent from its folder",
          "settings.sidebar-folders.actions",
          { type: "assign", agentId, sectionId: null },
        ),
      );
    sections.push({ id: "sidebar-folders", title: mFallback(msg("Sidebar folders")), controls });
  }
  if (agentId && has("side-question")) {
    const answer = settingRecord(values["settings.side-question.ask"]);
    const parameters = settingRecord(values["parameters:settings.side-question.ask"]);
    const controls: SettingControl[] = [
      text(
        "explanation",
        "Ask about this chat without changing it. Uses this agent's provider; no tools run.",
      ),
      input("sideQuestion", "Side question"),
    ];
    if (drafts.sideQuestion?.trim())
      controls.push(
        button(
          "ask",
          "Ask side question",
          "settings.side-question.ask",
          { agentId, question: drafts.sideQuestion.trim(), earlier: [] },
          true,
        ),
      );
    if (parameters.agentId === agentId && typeof answer.answer === "string") {
      controls.push(text("answer", answer.answer));
      if (drafts.sideQuestion?.trim() && typeof parameters.question === "string") {
        const earlier = [
          ...rows(parameters.earlier),
          { question: parameters.question, answer: answer.answer },
        ]
          .filter((turn) => typeof turn.question === "string" && typeof turn.answer === "string")
          .slice(-20)
          .map((turn) => ({
            question: String(turn.question).slice(0, 100000),
            answer: String(turn.answer).slice(0, 32000),
          }));
        controls.push(
          button(
            "followup",
            "Ask follow-up using these side answers",
            "settings.side-question.ask",
            { agentId, question: drafts.sideQuestion.trim(), earlier },
            true,
          ),
        );
      }
    }
    sections.push({ id: "side-question", title: mFallback(msg("Side question")), controls });
  }
  if (has("workflows-github")) {
    const workflowId = drafts.githubWorkflow ?? "";
    const historyParams = settingRecord(values["parameters:settings.workflows-github.history"]);
    const history =
      historyParams.workflowId === workflowId
        ? settingRecord(values["settings.workflows-github.history"])
        : {};
    const catalog = settingRecord(values["settings.workflows-github.catalog"]);
    const controls: SettingControl[] = [
      button("catalog", "Read connected repositories", "settings.workflows-github.catalog", {}),
      input("githubWorkflow", "Workflow ID"),
    ];
    if (catalog.connected === false)
      controls.push(
        text("disconnected", "Connect GitHub on this host to configure event workflows."),
      );
    for (const repo of rows(catalog.repositories).slice(
      Math.max(0, Number(drafts.githubRepoOffset) || 0),
      Math.max(0, Number(drafts.githubRepoOffset) || 0) + 25,
    ))
      if (typeof repo.fullName === "string")
        controls.push(
          button(
            repo.fullName,
            `Labels and people: ${repo.fullName}`,
            "settings.workflows-github.options",
            { repository: repo.fullName },
          ),
        );
    for (const [key, length, label] of [
      ["githubRepoOffset", rows(catalog.repositories).length, "repositories"],
      ["githubEventOffset", rows(history.deliveries).length, "events"],
    ] as const) {
      const offset = Math.max(0, Number(drafts[key]) || 0);
      if (offset > 0)
        controls.push({
          id: `${key}:prev`,
          kind: "button",
          label: mFallback(msg("Previous 25 {label}", { label })),
          inputKey: key,
          value: String(Math.max(0, offset - 25)),
        });
      if (offset + 25 < length)
        controls.push({
          id: `${key}:next`,
          kind: "button",
          label: mFallback(msg("Next 25 {label}", { label })),
          inputKey: key,
          value: String(offset + 25),
        });
    }
    const options = settingRecord(values["settings.workflows-github.options"]);
    if (options.labels)
      controls.push(
        text(
          "labels",
          rows(options.labels)
            .map((label) => String(label.name))
            .join(", "),
        ),
      );
    if (Array.isArray(options.people)) controls.push(text("people", options.people.join(", ")));
    if (workflowId)
      controls.push(
        button("history", "Read GitHub event history", "settings.workflows-github.history", {
          workflowId,
        }),
      );
    const deliveries = rows(history.deliveries);
    const latestByNode = new Map<string, Record<string, Json>>();
    for (const delivery of deliveries)
      if (typeof delivery.nodeId === "string") {
        const previous = latestByNode.get(delivery.nodeId);
        if (!previous || String(delivery.receivedAt) > String(previous.receivedAt))
          latestByNode.set(delivery.nodeId, delivery);
      }
    if (deliveries.length)
      controls.push(
        text(
          "latest-event",
          "Run uses the latest event on the host at execution time, not a selected historical event.",
        ),
      );
    for (const delivery of deliveries.slice(
      Math.max(0, Number(drafts.githubEventOffset) || 0),
      Math.max(0, Number(drafts.githubEventOffset) || 0) + 25,
    )) {
      controls.push(
        text(
          String(delivery.id),
          `${String(delivery.event)} · ${String(delivery.outcome)} · ${String(delivery.reason ?? "")} · ${String(settingRecord(delivery.item).title ?? "")}`,
        ),
      );
      if (
        typeof delivery.nodeId === "string" &&
        typeof delivery.id === "string" &&
        latestByNode.get(delivery.nodeId)?.id === delivery.id
      )
        controls.push(
          button(
            `run:${delivery.id}`,
            "Run this trigger with its latest event",
            "settings.workflows-github.runLastEvent",
            { workflowId, nodeId: delivery.nodeId, requestId: `sled:${delivery.id}` },
            true,
          ),
        );
    }
    const run = settingRecord(settingRecord(values["settings.workflows-github.runLastEvent"]).run);
    if (run.id)
      controls.push(text("run", `Run ${String(run.id)}: ${String(run.status ?? "accepted")}`));
    sections.push({
      id: "workflows-github",
      title: mFallback(msg("GitHub workflow events")),
      controls,
    });
  }
  if (agentId && has("agent-fast-mode")) {
    const controls: SettingControl[] = [
      button("models", "List models with a fast tier", "settings.agent-fast-mode.models", {}),
    ];
    for (const model of rows(settingRecord(values["settings.agent-fast-mode.models"]).models))
      controls.push(
        text(
          `${String(model.provider)}:${String(model.id)}`,
          `${String(model.provider)} · ${String(model.id)} · ${String(model.fastServiceTier)}`,
        ),
      );
    sections.push({ id: "fast-models", title: mFallback(msg("Available fast models")), controls });
  }
  if (agentId && has("agent-hidden")) {
    const hidden = rows(settingRecord(value("settings.agent-hidden.read")).agents).some(
      (a) => a.agentId === agentId,
    );
    sections.push({
      id: "hidden",
      title: mFallback(msg("Agent visibility")),
      controls: [
        text("state", hidden ? "Hidden: new messages and routines are paused" : "Visible"),
        button("refresh", "Refresh visibility", "settings.agent-hidden.read", {}),
        button("hide", "Hide agent", "settings.agent-hidden.set", { agentId, hidden: true }, true),
        button("restore", "Restore agent", "settings.agent-hidden.set", { agentId, hidden: false }),
      ],
    });
  }
  if (agentId && has("agent-folders")) {
    const latest = settingRecord(value("settings.agent-folders.read"));
    const folders = settingRecord(latest.list ?? latest);
    const controls: SettingControl[] = [
      button("read", "Refresh folders", "settings.agent-folders.read", { agentId }),
      input("folderPath", "Folder on the host"),
      input("replaceFolder", "Existing folder to replace (optional)"),
      button("browse", "Browse folder", "settings.agent-folders.browse", {
        agentId,
        path: drafts.folderPath || null,
      }),
    ];
    for (const folder of rows(folders.folders))
      if (typeof folder.path === "string")
        controls.push(
          text(`folder:${folder.path}`, `${folder.path}${folder.found ? "" : " (missing)"}`),
        );
    if (Array.isArray(folders.excluded))
      for (const path of folders.excluded)
        if (typeof path === "string") controls.push(text(`excluded:${path}`, `Excluded: ${path}`));
    for (const entry of rows(latest.entries))
      if (typeof entry.path === "string") controls.push(text(`browse:${entry.path}`, entry.path));
    for (const action of ["add", "remove", "exclude", "include"] as const)
      controls.push(
        button(
          action,
          {
            add: "Allow folder",
            remove: "Remove allowed folder",
            exclude: "Exclude folder",
            include: "Restore excluded folder",
          }[action],
          `settings.agent-folders.${action}`,
          {
            agentId,
            path: drafts.folderPath ?? "",
            ...(action === "add" && drafts.replaceFolder ? { replace: drafts.replaceFolder } : {}),
          },
          true,
        ),
      );
    sections.push({
      id: "folders",
      title: mFallback(msg("Additional workspace folders")),
      controls,
    });
  }
  if (agentId && has("agent-backup-models")) {
    const data = settingRecord(value("settings.agent-backup-models.settings"));
    const backup = settingRecord(data.backupModels);
    const order = rows(backup.order);
    const controls: SettingControl[] = [
      button("read", "Refresh backup models", "settings.agent-backup-models.settings", { agentId }),
      input("backupProvider", "Provider ID"),
      input("backupModel", "Model ID"),
      input("backupAccount", "Provider account ID (optional)"),
    ];
    if (data.backupModels !== undefined) {
      const choice: Record<string, Json> = {
        provider: drafts.backupProvider ?? "",
        model: drafts.backupModel ?? "",
      };
      if (drafts.backupAccount) choice.providerAccountId = drafts.backupAccount;
      controls.push(
        button("add", "Add backup model", "settings.agent-backup-models.update", {
          agentId,
          backupModels: { automatic: backup.automatic === true, order: [...order, choice] },
        }),
      );
      controls.push(
        button(
          "automatic",
          backup.automatic ? "Ask before switching models" : "Switch models automatically",
          "settings.agent-backup-models.update",
          { agentId, backupModels: { automatic: backup.automatic !== true, order: [...order] } },
        ),
      );
      controls.push(
        button(
          "reset",
          "Clear backup order and ask in chat",
          "settings.agent-backup-models.update",
          { agentId, backupModels: null },
        ),
      );
      order.forEach((item, index) => {
        controls.push(text(`model:${index}`, `${String(item.provider)} · ${String(item.model)}`));
        controls.push(
          button(`remove:${index}`, "Remove backup model", "settings.agent-backup-models.update", {
            agentId,
            backupModels: {
              automatic: backup.automatic === true,
              order: order.filter((_, i) => i !== index),
            },
          }),
        );
        if (index > 0) {
          const moved = [...order];
          [moved[index - 1], moved[index]] = [moved[index]!, moved[index - 1]!];
          controls.push(
            button(`up:${index}`, "Move earlier", "settings.agent-backup-models.update", {
              agentId,
              backupModels: { automatic: backup.automatic === true, order: moved },
            }),
          );
        }
      });
    }
    sections.push({ id: "backups", title: mFallback(msg("Backup models")), controls });
  }
  if (agentId && has("agent-session-settings")) {
    const data = settingRecord(value("settings.agent-session-settings.read"));
    const controls: SettingControl[] = [
      button("read", "Refresh session settings", "settings.agent-session-settings.read", {
        agentId,
      }),
    ];
    for (const option of rows(data.options))
      if (typeof option.id === "string") {
        const settingId = option.id;
        controls.push(
          text(`option:${settingId}`, `${String(option.name)}: ${String(option.currentValue)}`),
        );
        const choices =
          option.type === "boolean"
            ? [
                { name: "On", value: true },
                { name: "Off", value: false },
              ]
            : rows(option.options);
        for (const choice of choices)
          if (typeof choice.value === "string" || typeof choice.value === "boolean")
            controls.push(
              button(
                `${settingId}:${String(choice.value)}`,
                String(choice.name),
                "settings.agent-session-settings.set",
                { agentId, settingId, value: choice.value },
              ),
            );
        controls.push(
          button(
            `reset:${settingId}`,
            "Reset to provider default",
            "settings.agent-session-settings.reset",
            { agentId, settingId },
          ),
        );
      }
    sections.push({ id: "session", title: mFallback(msg("Provider session settings")), controls });
  }
  if (agentId && has("agent-memories")) {
    const selection = settingRecord(values["settings.agent-memories.selection"]);
    const data = selection.agentId === agentId ? selection : {};
    const controls: SettingControl[] = [
      button("read", "Refresh memory inclusion", "settings.agent-memories.selection", {
        agentId,
        after: null,
      }),
    ];
    if (typeof data.usedBytes === "number")
      controls.push(
        text(
          "budget",
          `${data.usedBytes} of ${String(data.budgetBytes)} bytes in essential memory`,
        ),
      );
    for (const entry of rows(data.selections).slice(
      Math.max(0, Number(drafts.memoryOffset) || 0),
      Math.max(0, Number(drafts.memoryOffset) || 0) + 25,
    ))
      if (typeof entry.memoryId === "string" && typeof entry.revision === "number") {
        controls.push(text(entry.memoryId, `${entry.memoryId}: ${String(entry.inclusion)}`));
        for (const inclusion of ["essential", "searchable", "automatic"] as const)
          controls.push(
            button(
              `${entry.memoryId}:${inclusion}`,
              `Use ${inclusion}`,
              "settings.agent-memories.inclusion",
              {
                agentId,
                changes: [
                  { memoryId: entry.memoryId, inclusion, expectedRevision: entry.revision },
                ],
              },
            ),
          );
      }
    const offset = Math.max(0, Number(drafts.memoryOffset) || 0);
    if (offset > 0)
      controls.push({
        id: "previous-entries",
        kind: "button",
        label: mFallback(msg("Previous 25 memories")),
        inputKey: "memoryOffset",
        value: String(Math.max(0, offset - 25)),
      });
    if (offset + 25 < rows(data.selections).length)
      controls.push({
        id: "next-entries",
        kind: "button",
        label: mFallback(msg("Next 25 memories")),
        inputKey: "memoryOffset",
        value: String(offset + 25),
      });
    if (typeof data.nextCursor === "string")
      controls.push(
        button("next", "Next memory page", "settings.agent-memories.selection", {
          agentId,
          after: data.nextCursor,
        }),
      );
    const page = settingRecord(values["settings.agent-memories.page"]);
    controls.push(
      button("read-text", "Read memory text", "settings.agent-memories.page", {
        agentId,
        after: null,
      }),
    );
    const memoryOffset = Math.max(0, Number(drafts.memoryTextOffset) || 0);
    const memories = rows(page.memories).filter((memory) => memory.agentId === agentId);
    for (const memory of memories.slice(memoryOffset, memoryOffset + 25))
      controls.push(
        text(`text:${String(memory.id)}`, `${String(memory.text)} · ${String(memory.origin)}`),
      );
    if (memoryOffset > 0)
      controls.push({
        id: "previous-text",
        kind: "button",
        label: mFallback(msg("Previous 25 texts")),
        inputKey: "memoryTextOffset",
        value: String(Math.max(0, memoryOffset - 25)),
      });
    if (memoryOffset + 25 < memories.length)
      controls.push({
        id: "next-text",
        kind: "button",
        label: mFallback(msg("Next 25 texts")),
        inputKey: "memoryTextOffset",
        value: String(memoryOffset + 25),
      });
    if (typeof page.nextCursor === "string")
      controls.push(
        button("next-text-page", "Next page of memory text", "settings.agent-memories.page", {
          agentId,
          after: page.nextCursor,
        }),
      );
    sections.push({ id: "memories", title: mFallback(msg("Memory inclusion")), controls });
  }
  if (has("agent-notification-levels")) {
    const controls: SettingControl[] = [
      button("read", "Refresh notification levels", "settings.agent-notification-levels.read", {}),
    ];
    for (const level of [null, "all", "needs-me", "nothing"] as const)
      controls.push(
        button(
          String(level),
          {
            all: "All activity",
            "needs-me": "Needs my attention",
            nothing: "None",
            default: "Follow default",
          }[level ?? "default"],
          agentId
            ? "settings.agent-notification-levels.set"
            : "settings.agent-notification-levels.server",
          agentId ? { agentId, level } : { level },
        ),
      );
    sections.push({
      id: "notifications",
      title: mFallback(msg("Notifications for the connected host member")),
      controls,
    });
  }
  if (agentId && (has("context-compact") || has("context-reset"))) {
    const controls: SettingControl[] = [
      text(
        "retained",
        "Messages remain in history. These commands refuse while the agent is busy.",
      ),
    ];
    if (has("context-compact"))
      controls.push(
        button(
          "compact",
          "Compact this chat context",
          "settings.context-compact.compact",
          { agentId },
          true,
        ),
        input("contextTask", "Side task ID (optional)"),
        button(
          "compactTask",
          "Compact side task context",
          "settings.context-compact.compactTask",
          { agentId, taskId: drafts.contextTask ?? "" },
          true,
        ),
      );
    if (has("context-reset"))
      controls.push(
        button(
          "reset",
          "Begin a fresh chat context",
          "settings.context-reset.clear",
          { agentId },
          true,
        ),
      );
    sections.push({ id: "context", title: mFallback(msg("Conversation context")), controls });
  }
  if (agentId && has("sidebar-pins")) {
    const data = settingRecord(value("settings.sidebar-pins.read"));
    const items = rows(data.items);
    const pinned = items.some((item) => item.kind === "agent" && item.id === agentId);
    sections.push({
      id: "pins",
      title: mFallback(msg("Pinned chats")),
      controls: [
        button("read", "Refresh pinned chats", "settings.sidebar-pins.read", {}),
        ...(Array.isArray(data.items)
          ? [
              button("pin", pinned ? "Unpin agent" : "Pin agent", "settings.sidebar-pins.set", {
                items: pinned
                  ? items.filter((item) => !(item.kind === "agent" && item.id === agentId))
                  : [...items, { kind: "agent", id: agentId }],
              }),
            ]
          : []),
      ],
    });
  }
  if (has("agent-access")) {
    const data = settingRecord(value("settings.agent-access.read"));
    const roles = rows(data.roles);
    const everyone = settingRecord(data.everyone);
    const controls: SettingControl[] = [
      button("read", "Refresh roles and access", "settings.agent-access.read", {}),
      text(
        "authority",
        "Roles apply to the connected bot host. Owners and admins retain full access.",
      ),
    ];
    if (
      typeof data.revision === "number" &&
      data.everyone !== undefined &&
      data.roles !== undefined
    ) {
      if (agentId)
        for (const level of ["none", "view", "chat", "manage"] as const)
          controls.push(
            button(
              `everyone:${level}`,
              `Everyone: ${level}`,
              "settings.agent-access.set",
              {
                revision: data.revision,
                everyone: { ...everyone, [agentId]: level },
                roles: [...roles],
              },
              true,
            ),
          );
      controls.push(
        input("roleId", "New role ID"),
        input("roleName", "Role name"),
        input("roleMembers", "Member IDs, separated by commas"),
      );
      if (!agentId) controls.push(input("roleAgent", "Agent ID for this role"));
      const memberIds = (drafts.roleMembers ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const target = agentId ?? drafts.roleAgent ?? "";
      for (const level of ["view", "chat", "manage"] as const)
        controls.push(
          button(
            `create:${level}`,
            `Create role with ${level} access`,
            "settings.agent-access.set",
            {
              revision: data.revision,
              everyone,
              roles: [
                ...roles,
                {
                  id: drafts.roleId ?? "",
                  name: drafts.roleName ?? "",
                  memberIds,
                  agents: target ? { [target]: level } : {},
                },
              ],
            },
            true,
          ),
        );
      for (const role of roles)
        if (typeof role.id === "string") {
          const roleId = role.id;
          controls.push(
            text(
              `role:${roleId}`,
              `${String(role.name)} · ${Array.isArray(role.memberIds) ? role.memberIds.join(", ") : "No members"}`,
            ),
          );
          controls.push(
            button(
              `members:${roleId}`,
              "Replace role members with entered IDs",
              "settings.agent-access.set",
              {
                revision: data.revision,
                everyone,
                roles: roles.map((item) => (item.id === roleId ? { ...item, memberIds } : item)),
              },
              true,
            ),
          );
          if (agentId)
            for (const level of ["none", "view", "chat", "manage"] as const)
              controls.push(
                button(
                  `role:${roleId}:${level}`,
                  `${String(role.name)}: ${level} this agent`,
                  "settings.agent-access.set",
                  {
                    revision: data.revision,
                    everyone,
                    roles: roles.map((item) =>
                      item.id === roleId
                        ? { ...item, agents: { ...settingRecord(item.agents), [agentId]: level } }
                        : item,
                    ),
                  },
                  true,
                ),
              );
          controls.push(
            button(
              `remove:${roleId}`,
              "Remove role",
              "settings.agent-access.set",
              {
                revision: data.revision,
                everyone,
                roles: roles.filter((item) => item.id !== roleId),
              },
              true,
            ),
          );
        }
    }
    sections.push({ id: "access", title: mFallback(msg("Roles and agent access")), controls });
  }
  if (!agentId && has("discord-access")) {
    const workspaceId = drafts.discordWorkspace ?? "";
    const latest = settingRecord(value("settings.discord-access.access"));
    const accessRead =
      settingRecord(values["parameters:settings.discord-access.access"]).workspaceId === workspaceId
        ? settingRecord(values["settings.discord-access.access"])
        : {};
    const access =
      settingRecord(values["latest-parameters:discord-access"]).workspaceId === workspaceId &&
      latest.allowedRoles !== undefined
        ? latest
        : accessRead;
    const allowed = rows(access.allowedRoles);
    const available =
      settingRecord(values["parameters:settings.discord-access.roles"]).workspaceId === workspaceId
        ? rows(settingRecord(values["settings.discord-access.roles"]).roles)
        : [];
    const controls: SettingControl[] = [
      input("discordWorkspace", "Discord workspace ID"),
      button("access", "Read allowed roles", "settings.discord-access.access", { workspaceId }),
      button("roles", "List workspace roles", "settings.discord-access.roles", { workspaceId }),
    ];
    for (const role of access.allowedRoles === undefined ? [] : available)
      if (typeof role.id === "string" && typeof role.name === "string") {
        const enabled = allowed.some((item) => item.id === role.id);
        controls.push(
          button(
            role.id,
            `${enabled ? "Remove" : "Allow"} ${role.name}`,
            "settings.discord-access.update",
            {
              workspaceId,
              allowedRoles: enabled
                ? allowed.filter((item) => item.id !== role.id)
                : [...allowed, { id: role.id, name: role.name }],
            },
            true,
          ),
        );
      }
    sections.push({ id: "discord", title: mFallback(msg("Discord role access")), controls });
  }
  if (agentId && has("routine-results")) {
    const routineId = drafts.resultRoutine ?? "";
    const controls: SettingControl[] = [
      input("resultRoutine", "Routine ID"),
      button("options", "Refresh delivery connections", "settings.routine-results.options", {}),
      button(
        "destination",
        "Read routine delivery destination",
        "settings.routine-results.destination",
        { agentId, routineId },
      ),
    ];
    const parameters = settingRecord(values["parameters:settings.routine-results.destination"]);
    const read =
      parameters.agentId === agentId && parameters.routineId === routineId
        ? settingRecord(values["settings.routine-results.destination"])
        : {};
    if (read.destination !== undefined) {
      const destination = settingRecord(read.destination);
      controls.push(
        text(
          "current",
          read.destination === null
            ? "Result delivery is off"
            : `${String(destination.platform)} · ${String(destination.connectionName)} · ${String(destination.placeName)}`,
        ),
      );
      controls.push(
        button(
          "off",
          "Stop sending routine answers",
          "settings.routine-results.setDestination",
          { agentId, routineId, destination: null },
          true,
        ),
      );
      const connections = rows(
        settingRecord(values["settings.routine-results.options"]).connections,
      );
      const places = connections.flatMap((connection) =>
        rows(connection.places).map((place) => ({ connection, place })),
      );
      const offset = Math.max(0, Number(drafts.resultPlaceOffset) || 0);
      for (const { connection, place } of places.slice(offset, offset + 25))
        if (
          typeof connection.connectionId === "string" &&
          typeof place.id === "string" &&
          typeof place.name === "string"
        )
          controls.push(
            button(
              `${connection.connectionId}:${place.id}`,
              `Send to ${String(connection.connectionName)} · ${place.name}`,
              "settings.routine-results.setDestination",
              {
                agentId,
                routineId,
                destination: {
                  connectionId: connection.connectionId,
                  placeId: place.id,
                  placeName: place.name,
                },
              },
              true,
            ),
          );
      for (const connection of connections)
        if (connection.placesFailed)
          controls.push(
            text(
              `failed:${String(connection.connectionId)}`,
              `Could not load places for ${String(connection.connectionName)}. Refresh connections.`,
            ),
          );
      if (offset > 0)
        controls.push({
          id: "previous-places",
          kind: "button",
          label: mFallback(msg("Previous destinations")),
          inputKey: "resultPlaceOffset",
          value: String(Math.max(0, offset - 25)),
        });
      if (offset + 25 < places.length)
        controls.push({
          id: "next-places",
          kind: "button",
          label: mFallback(msg("More destinations")),
          inputKey: "resultPlaceOffset",
          value: String(offset + 25),
        });
    }
    sections.push({
      id: "routine-results",
      title: mFallback(msg("Routine answer delivery")),
      controls,
    });
  }
  if (agentId && has("skills-admin")) {
    const installed =
      settingRecord(values["parameters:settings.skills-admin.list"]).agentId === agentId
        ? rows(values["settings.skills-admin.list"])
        : [];
    const controls: SettingControl[] = [
      button("list", "Refresh installed skills", "settings.skills-admin.list", { agentId }),
    ];
    const detail = settingRecord(values["settings.local-catalog.skill"]);
    if (typeof detail.id === "string" && typeof detail.versionId === "string") {
      controls.push(text("review", `${String(detail.name)} · ${String(detail.instructions)}`));
      controls.push(
        button(
          "install-reviewed",
          "Install reviewed marketplace version",
          "settings.skills-admin.install",
          { agentId, skillId: detail.id, versionId: detail.versionId },
          true,
        ),
      );
    }
    for (const skill of installed)
      if (typeof skill.skillId === "string") {
        const skillId = skill.skillId;
        controls.push(
          text(
            skillId,
            `${String(skill.name)} · ${String(skill.state)} · installed ${String(skill.installedVersion)}, available ${String(skill.availableVersion)}${skill.problem ? ` · ${String(skill.problem)}` : ""}`,
          ),
        );
        if (typeof skill.enabled === "boolean")
          controls.push(
            button(
              `toggle:${skillId}`,
              skill.enabled ? "Disable skill" : "Enable skill",
              "settings.skills-admin.setEnabled",
              { agentId, skillId, enabled: !skill.enabled },
            ),
          );
        controls.push(
          button(
            `remove:${skillId}`,
            "Remove skill (preserve modified files)",
            "settings.skills-admin.uninstall",
            { agentId, skillId },
            true,
          ),
        );
      }
    controls.push(
      text(
        "modified",
        "Locally modified skills are protected. Refresh installed skills after an interrupted change before deciding what to do next.",
      ),
    );
    sections.push({ id: "installed-skills", title: mFallback(msg("Installed skills")), controls });
  }
  if (capabilities.includes("local-skill-catalog-v1")) {
    const controls: SettingControl[] = [
      input("catalogQuery", "Search the marketplace"),
      button("search-skills", "Search skills", "settings.local-catalog.searchSkills", {
        query: drafts.catalogQuery ?? "",
        limit: 25,
      }),
      button("search-agents", "Search agents", "settings.local-catalog.searchAgents", {
        query: drafts.catalogQuery ?? "",
        limit: 25,
      }),
      button("my-skills", "My published skills", "settings.local-catalog.mySkills", {}),
      button("my-agents", "My published agents", "settings.local-catalog.myAgents", {}),
      button("local-list", "Refresh local skill library", "settings.local-catalog.localList", {}),
    ];
    for (const [key, field] of [
      ["settings.local-catalog.searchSkills", "skills"],
      ["settings.local-catalog.searchAgents", "agents"],
      ["settings.local-catalog.localList", "skills"],
    ] as const) {
      const data = settingRecord(values[key]);
      for (const item of rows(data[field]))
        controls.push(
          text(
            `${key}:${String(item.id)}`,
            `${String(item.name)} · ${String(item.id)} · version ${String(item.version)} · ${String(item.description)}`,
          ),
        );
      if (typeof data.nextCursor === "string")
        controls.push(
          button(
            `${key}:next`,
            "Next catalog page",
            key,
            key === "settings.local-catalog.localList"
              ? { after: data.nextCursor, limit: 25 }
              : { query: drafts.catalogQuery ?? "", cursor: data.nextCursor, limit: 25 },
          ),
        );
    }
    for (const key of [
      "settings.local-catalog.mySkills",
      "settings.local-catalog.myAgents",
    ] as const)
      for (const item of rows(values[key]))
        controls.push(
          text(
            `${key}:${String(item.id)}`,
            `${String(item.name)} · ${String(item.status)}${item.rejectionNote ? ` · ${String(item.rejectionNote)}` : ""}`,
          ),
        );
    controls.push(
      input("catalogSkill", "Skill ID"),
      input("catalogSlug", "Shared skill slug (optional)"),
      input("catalogRevision", "Local revision (blank reads latest)"),
      button("read-skill", "Review marketplace skill", "settings.local-catalog.skill", {
        skillId: drafts.catalogSkill ?? "",
      }),
      button("read-slug", "Read shared skill", "settings.local-catalog.skillBySlug", {
        slug: drafts.catalogSlug ?? "",
      }),
      button("read-local", "Review local skill", "settings.local-catalog.localGet", {
        skillId: drafts.catalogSkill ?? "",
        ...(drafts.catalogRevision ? { revision: Number(drafts.catalogRevision) } : {}),
      }),
    );
    const latest = settingRecord(value("settings.local-catalog.localGet"));
    if (typeof latest.instructions === "string") {
      controls.push(text("instructions", latest.instructions));
      for (const name of Array.isArray(latest.files) ? latest.files : [])
        if (typeof name === "string") controls.push(text(`file:${name}`, name));
    }
    if (agentId) {
      controls.push(
        input("localSource", "Skill folder relative to this agent workspace"),
        button(
          "create-local",
          "Save and install new local skill",
          "settings.local-catalog.localCreate",
          { agentId, sourcePath: drafts.localSource ?? "" },
          true,
        ),
        button(
          "revise-local",
          "Save a new local revision",
          "settings.local-catalog.localRevise",
          {
            agentId,
            skillId: drafts.catalogSkill ?? "",
            expectedRevision: Number(drafts.catalogRevision),
            sourcePath: drafts.localSource ?? "",
          },
          true,
        ),
        button(
          "install-local",
          "Install local revision on this agent",
          "settings.local-catalog.localInstall",
          { agentId, skillId: drafts.catalogSkill ?? "", revision: Number(drafts.catalogRevision) },
          true,
        ),
      );
    }
    controls.push(
      text(
        "recovery",
        "A local skill name is unique. If a save loses its response, refresh the library and read the saved revision before another create. Bundle downloads are available in Files.",
      ),
    );
    sections.push({
      id: "catalog",
      title: mFallback(msg("Marketplace and local skill library")),
      controls,
    });
  }
  return sections;
}
