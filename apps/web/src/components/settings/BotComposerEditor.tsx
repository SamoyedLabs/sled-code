import { COMPOSER_PROMPT_SURFACE } from "../chat/composerPromptSurface";
/* oxlint-disable shadcn/no-unknown-classes -- Scoped source ComposerEditor and mention-picker styles are imported by BotConversationPanel. */
import {
  useEffect,
  useId,
  useRef,
  useImperativeHandle,
  useState,
  type Ref,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Node, Extension, type Editor } from "@tiptap/core";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { type EnvironmentId, OpenbotAgentList } from "@t3tools/contracts";
import {
  botConnectionResult,
  EMPTY_BOT_CONNECTIONS,
  type BotConnectionState,
} from "@t3tools/client-runtime/openbot/presentation";
import { FileIcon, PuzzleIcon, BotIcon, BlocksIcon, TextQuoteIcon } from "lucide-react";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "../../lib/observeResize";
import { limitedBotQuoteText } from "./botSelectionModel";
import { BotAvatar } from "../bots/avatar/BotAvatar";
import {
  serializeBotReference,
  botComposerContent,
  botComposerText,
  botMentionAtCaret,
  rankBotComposerOptions,
  type BotComposerOption,
} from "./botComposerModel";

export type BotComposerEditorHandle = {
  focus: () => void;
  openSkills: () => void;
  insertQuote: (messageId: string, text: string) => boolean;
};
type Props = {
  ref?: Ref<BotComposerEditorHandle>;
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
  allowedAgentIds?: readonly string[];
  includeSelf?: boolean;
  skillsEnabled?: boolean;
  onFiles?: ((files: File[]) => void) | undefined;
  attachments: readonly { id: string; name: string }[];
};
const decodeAgents = Schema.decodeUnknownResult(OpenbotAgentList);
const Reference = Node.create({
  name: "botReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ kind: { default: "agent" }, id: { default: "" }, name: { default: "" } }),
  parseHTML: () => [
    {
      tag: "span[data-bot-reference]",
      getAttrs: (element) => ({
        kind: element.getAttribute("data-kind"),
        id: element.getAttribute("data-reference-id"),
        name: element.getAttribute("data-reference-name"),
      }),
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    {
      "data-bot-reference": "",
      "data-kind": node.attrs.kind,
      "data-reference-id": node.attrs.id,
      "data-reference-name": node.attrs.name,
      class: "ob-chat-reference-chip",
      contenteditable: "false",
    },
    [
      "span",
      { class: "ob-chat-reference-chip-icon", "aria-hidden": "true" },
      node.attrs.kind === "agent" ? "@" : node.attrs.kind === "skill" ? "$" : "↗",
    ],
    ["span", { class: "ob-chat-reference-chip-name" }, node.attrs.name],
  ],
  renderText: ({ node }) => serializeBotReference(node.attrs.kind, node.attrs.name, node.attrs.id),
  addNodeView: () => ReactNodeViewRenderer(ReferenceChip),
});
function ReferenceChip({ node }: NodeViewProps) {
  const kind = String(node.attrs.kind);
  const name = String(node.attrs.name);
  return (
    <NodeViewWrapper
      as="span"
      className="ob-chat-reference-chip"
      contentEditable={false}
      data-kind={kind}
      aria-label={`${kind}: ${name}`}
    >
      <span className="ob-chat-reference-chip-icon" aria-hidden="true">
        {kind === "agent" ? (
          <BotAvatar seed={String(node.attrs.id)} size={16} />
        ) : kind === "skill" ? (
          <PuzzleIcon />
        ) : kind === "quote" ? (
          <TextQuoteIcon />
        ) : kind === "mcp" ? (
          <BlocksIcon />
        ) : (
          <FileIcon />
        )}
      </span>
      <span className="ob-chat-reference-chip-name">{name}</span>
    </NodeViewWrapper>
  );
}
const LengthLimit = Extension.create({
  name: "botComposerLength",
  addProseMirrorPlugins: () => [
    new Plugin({
      filterTransaction: (transaction) =>
        !transaction.docChanged || botComposerText(transaction.doc).length <= 100000,
    }),
  ],
});
const extensions = [
  StarterKit.configure({
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    link: false,
    code: false,
    codeBlock: false,
    blockquote: false,
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    horizontalRule: false,
    trailingNode: false,
    dropcursor: false,
    gapcursor: false,
  }),
  Reference,
  LengthLimit,
];
type Mention = NonNullable<ReturnType<typeof botMentionAtCaret>> & { from: number; to: number };

export function BotComposerEditor({
  ref,
  environmentId,
  hostId,
  agentId,
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  attachments,
  allowedAgentIds,
  includeSelf = false,
  skillsEnabled = true,
  onFiles,
}: Props) {
  const listId = useId();
  const editorInstance = useRef<Editor | null>(null);
  const savedCaret = useRef<number | null>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [active, setActive] = useState(0);
  const [requestedSkill, setRequestedSkill] = useState(false);
  const [frame, setFrame] = useState<{ mount: HTMLElement; bottom: number } | null>(null);
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const skillRequest = {
    hostId,
    request: { operation: "settings.skills-admin.list" as const, parameters: { agentId } },
  };
  const canReadSkills = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, skillRequest),
  );
  const skillsQuery = useEnvironmentQuery(
    skillsEnabled && mention?.trigger === "$" && canReadSkills
      ? openbot.readFromHost({ environmentId, input: skillRequest })
      : null,
  );
  const skillsOpen = skillsEnabled && mention?.trigger === "$";
  const canReadMcp = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "mcp.list" },
    }),
  );
  const readAdmin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [mcps, setMcps] = useState<BotConnectionState["mcps"]>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The existing host protocol exposes this read-only tool listing through its permission-gated admin command. Refresh when the $ picker opens; discard late results on host change/unmount.
  useEffect(() => {
    if (!skillsOpen || !canReadMcp) return;
    let current = true;
    void readAdmin({ environmentId, input: { hostId, request: { operation: "mcp.list" } } }).then(
      (result) => {
        if (!current) return;
        setMcps(
          result._tag === "Success"
            ? (botConnectionResult(EMPTY_BOT_CONNECTIONS, { operation: "mcp.list" }, result.value)
                ?.mcps ?? null)
            : null,
        );
      },
      () => {
        if (current) setMcps(null);
      },
    );
    return () => {
      current = false;
    };
  }, [skillsOpen, canReadMcp, environmentId, hostId, readAdmin]);
  const agents = decodeAgents(agentsQuery.data);
  const installed = botConnectionResult(
    EMPTY_BOT_CONNECTIONS,
    { operation: "skill.list", agentId },
    skillsQuery.data,
  )?.skills;
  const agentOptions: BotComposerOption[] = Result.isSuccess(agents)
    ? agents.success
        .filter(
          (agent) =>
            (includeSelf || agent.id !== agentId) &&
            (!allowedAgentIds || allowedAgentIds.includes(agent.id)),
        )
        .map((agent) => ({
          kind: "agent",
          id: agent.id,
          name: agent.name,
          description: agent.title,
          badge: "Agent",
          seed: agent.avatarSeed ?? agent.id,
          hue: agent.avatarHue,
        }))
    : [];
  const skillOptions: BotComposerOption[] = (installed ?? [])
    .filter((skill) => skill.state !== "needs-repair" && skill.enabled !== false)
    .map((skill) => ({
      kind: "skill",
      id: skill.skillId,
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      badge:
        skill.origin === "local"
          ? "Custom"
          : skill.origin === "managed"
            ? "System"
            : skill.origin === "workspace"
              ? "Workspace"
              : "Marketplace",
    }));
  const mcpOptions: BotComposerOption[] = (mcps ?? [])
    .filter((server) => server.enabled)
    .map((server) => ({
      kind: "mcp",
      id: server.id,
      name: server.name,
      description: server.url,
      badge: "MCP",
    }));
  const fileOptions: BotComposerOption[] = attachments
    .filter((file) => !value.includes(`](attachment:${file.id})`))
    .map((file) => ({ kind: "attachment", id: file.id, name: file.name, badge: "File" }));
  const options = rankBotComposerOptions(
    mention?.trigger === "$"
      ? skillsEnabled
        ? [...skillOptions, ...mcpOptions]
        : []
      : [...agentOptions, ...fileOptions],
    mention?.query ?? "",
  );
  const skillStatus =
    mention?.trigger === "$" && options.length === 0 && (requestedSkill || !mention.query.trim())
      ? !canReadSkills
        ? "Skills are unavailable with this connection’s permissions."
        : skillsQuery.isPending
          ? "Loading skills…"
          : skillsQuery.error || (skillsQuery.data !== null && !installed)
            ? "Could not load installed skills."
            : "No skills installed for this agent."
      : null;
  const pickerOpen = mention !== null && (options.length > 0 || skillStatus !== null);
  const updateMention = useStableCallback((editor: Editor) => {
    if (editor.view.composing || !editor.state.selection.empty) {
      setMention(null);
      return;
    }
    const { $from } = editor.state.selection;
    const context = botMentionAtCaret(
      $from.parent.textBetween(0, $from.parentOffset, "\n", "\uFFFC"),
    );
    const next = context
      ? { ...context, from: $from.pos - (context.end - context.start), to: $from.pos }
      : null;
    setMention((current) =>
      current?.from === next?.from && current?.to === next?.to && current?.query === next?.query
        ? current
        : next,
    );
    setActive(0);
  });
  const insertOption = useStableCallback((option: BotComposerOption) => {
    const editor = editorInstance.current;
    if (!editor || !mention || disabled) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: mention.from, to: mention.to }, [
        { type: "botReference", attrs: { kind: option.kind, id: option.id, name: option.name } },
        { type: "text", text: " " },
      ])
      .run();
    setMention(null);
    setRequestedSkill(false);
  });
  const handleKeyDown = useStableCallback((event: KeyboardEvent) => {
    const editor = editorInstance.current;
    if (!editor || editor.view.composing || event.isComposing) return false;
    if (pickerOpen && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      if (event.key === "Escape") {
        setMention(null);
        event.preventDefault();
        return true;
      }
      if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        const next =
          (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        setActive(next);
        document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
        event.preventDefault();
        return true;
      }
      if (options.length && (event.key === "Enter" || event.key === "Tab")) {
        insertOption(options[Math.min(active, options.length - 1)]!);
        event.preventDefault();
        return true;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
      return true;
    }
    return false;
  });
  const changed = useStableCallback((editor: Editor) => {
    onChange(botComposerText(editor.state.doc));
    updateMention(editor);
  });
  const editor = useEditor({
    extensions,
    content: botComposerContent(value),
    editable: !disabled,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: `ob-chat-editor-surface ${COMPOSER_PROMPT_SURFACE}`,
        role: "textbox",
        "aria-label": "Message to bot",
        "aria-multiline": "true",
        "data-placeholder": placeholder,
      },
      handleKeyDown: (_view, event) => handleKeyDown(event),
      handleDOMEvents: {
        click: () => {
          const current = editorInstance.current;
          if (current) updateMention(current);
          return false;
        },
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length || !onFiles || disabled) return false;
        event.preventDefault();
        event.stopPropagation();
        onFiles(files);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length && onFiles && !disabled) {
          event.preventDefault();
          event.stopPropagation();
          onFiles(files);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        editorInstance.current?.commands.insertContent(
          botComposerContent(text).content?.[0]?.content ?? [],
        );
        return true;
      },
    },
    onCreate: ({ editor }) => {
      editorInstance.current = editor;
    },
    onDestroy: () => {
      editorInstance.current = null;
    },
    onUpdate: ({ editor }) => changed(editor),
    onSelectionUpdate: ({ editor }) => {
      if (editor.isFocused) savedCaret.current = editor.state.selection.to;
      updateMention(editor);
    },
    onBlur: ({ editor }) => {
      savedCaret.current = editor.state.selection.to;
      setMention(null);
      setRequestedSkill(false);
    },
  });
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus();
      },
      insertQuote: (messageId, text) => {
        if (!editor || disabled) return false;
        const name = limitedBotQuoteText(text);
        if (!name) return false;
        const end = editor.state.doc.content.size - 1;
        const offset =
          savedCaret.current === null || savedCaret.current > end ? end : savedCaret.current;
        const position = editor.state.doc.resolve(Math.max(1, offset));
        const before = position.parent.textBetween(0, position.parentOffset, "\n", "\uFFFC");
        const leading = before && !/\s$/u.test(before) ? " " : "";
        if (
          botComposerText(editor.state.doc).length +
            leading.length +
            serializeBotReference("quote", name, messageId).length +
            1 >
          100000
        )
          return false;
        editor
          .chain()
          .focus()
          .insertContentAt(position.pos, [
            ...(leading ? [{ type: "text", text: leading }] : []),
            { type: "botReference", attrs: { kind: "quote", id: messageId, name } },
            { type: "text", text: " " },
          ])
          .run();
        savedCaret.current = editor.state.selection.to;
        setMention(null);
        return true;
      },
      openSkills: () => {
        if (!editor || disabled) return;
        editor.commands.focus();
        const { $to } = editor.state.selection;
        const before = $to.parent.textBetween(0, $to.parentOffset, "\n", "\uFFFC");
        editor
          .chain()
          .setTextSelection($to.pos)
          .insertContent(`${before && !/\s$/u.test(before) ? " " : ""}$`)
          .run();
        setRequestedSkill(true);
        updateMention(editor);
      },
    }),
    [editor, disabled, updateMention],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize host draft restoration, native dictation and successful send clears into the external ProseMirror editor without echoing its own transactions.
  useEffect(() => {
    // EditorContent detaches its view before pending passive effects finish on navigation.
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled, false);
    editor.view.dom.setAttribute("data-placeholder", placeholder);
    editor.view.dom.setAttribute("aria-disabled", String(disabled));
    if (botComposerText(editor.state.doc) !== value)
      editor.commands.setContent(botComposerContent(value), { emitUpdate: false });
  }, [editor, value, disabled, placeholder]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source picker hangs off the measured composer top and follows multiline/attachment resizing.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const wrap = editor.view.dom.closest<HTMLElement>(".ob-chat-composer-wrap");
    const composer = editor.view.dom.closest<HTMLElement>(".ob-chat-composer");
    if (!wrap || !composer) return;
    return observeResize(composer, () => {
      const bottom = wrap.getBoundingClientRect().bottom - composer.getBoundingClientRect().top;
      setFrame((previous) =>
        previous?.mount === wrap && previous.bottom === bottom ? previous : { mount: wrap, bottom },
      );
    });
  }, [editor]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ARIA virtual focus follows the popup while actual focus stays in the editing surface.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const node = editor.view.dom;
    if (pickerOpen && options.length) {
      node.setAttribute("aria-controls", listId);
      node.setAttribute(
        "aria-activedescendant",
        `${listId}-${Math.min(active, options.length - 1)}`,
      );
    } else {
      node.removeAttribute("aria-controls");
      node.removeAttribute("aria-activedescendant");
    }
  }, [editor, pickerOpen, options.length, active, listId]);
  return (
    <div className="ob-chat-editor-root">
      <EditorContent editor={editor} className="ob-chat-rich-editor" />
      {pickerOpen &&
        frame &&
        createPortal(
          <div
            className="ob-chat-mention-picker"
            style={
              {
                "--mention-picker-bottom": `${frame.bottom}px`,
                "--mention-picker-rows": skillStatus ? 1 : options.length,
              } as CSSProperties
            }
          >
            {skillStatus ? (
              <p className="ob-chat-mention-picker-status" role="status">
                {skillStatus}
              </p>
            ) : (
              <div
                className="ob-chat-mention-picker-list"
                role="listbox"
                id={listId}
                aria-label={mention?.trigger === "$" ? "Skills" : "Mention"}
              >
                {options.map((option, index) => (
                  <div
                    key={`${option.kind}:${option.id}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === Math.min(active, options.length - 1)}
                    className={`ob-chat-mention-picker-option${index === Math.min(active, options.length - 1) ? " ob-chat-mention-picker-option-active" : ""}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => insertOption(option)}
                  >
                    {option.kind === "agent" ? (
                      <BotAvatar
                        seed={option.seed ?? option.id}
                        hue={option.hue ?? null}
                        size={20}
                      />
                    ) : (
                      <span className="ob-chat-mention-picker-skill-icon">
                        {option.kind === "skill" ? (
                          <PuzzleIcon />
                        ) : option.kind === "mcp" ? (
                          <BlocksIcon />
                        ) : (
                          <FileIcon />
                        )}
                      </span>
                    )}
                    <strong>{option.name}</strong>
                    {option.slug &&
                      options.filter((entry) => entry.name === option.name).length > 1 && (
                        <span className="ob-chat-mention-picker-slug">{option.slug}</span>
                      )}
                    <span className="ob-chat-mention-picker-description">{option.description}</span>
                    <span className="ob-chat-mention-picker-badge">
                      {option.kind === "agent" ? (
                        <BotIcon />
                      ) : option.kind === "skill" ? (
                        <PuzzleIcon />
                      ) : (
                        <FileIcon />
                      )}
                      {option.badge}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>,
          frame.mount,
        )}
    </div>
  );
}
