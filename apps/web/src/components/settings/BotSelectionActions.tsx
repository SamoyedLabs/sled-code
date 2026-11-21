/* oxlint-disable shadcn/no-unknown-classes -- Source SelectionActions styles are scoped in bot-conversation.css. */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { TextQuoteIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../bots/upstream/OpenbotTooltip";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { isMacPlatform } from "../../lib/utils";
import { observeResize } from "../../lib/observeResize";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  botMessageTextSelection,
  botFileQuoteTarget,
  serializeBotFileSelectionInstruction,
  selectionActionInstructions,
  serializeBotSelectionInstruction,
  botQuoteShortcut,
  botSelectionPosition,
  type MessageTextSelection,
  type SelectionRect,
} from "./botSelectionModel";

export function BotSelectionActions(props: {
  root: RefObject<HTMLElement | null>;
  disabled: boolean;
  includeFiles?: boolean;
  onQuote: (messageId: string, text: string) => void;
  onSend: (messageId: string, body: string) => Promise<boolean>;
}) {
  const [selection, setSelection] = useState<MessageTextSelection | null>(null);
  const capture = useStableCallback(() => {
    const root = props.root.current;
    setSelection(
      !props.disabled && root
        ? botMessageTextSelection(window.getSelection(), root, props.includeFiles)
        : null,
    );
  });
  const dismiss = useStableCallback(() => {
    setSelection(null);
    if (selection) window.getSelection()?.removeAllRanges();
  });
  const quote = useStableCallback(() => {
    if (!selection || props.disabled) return;
    dismiss();
    props.onQuote(selection.messageId, selection.text);
  });
  const mac = isMacPlatform(navigator.platform);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The browser owns the text selection. Capture only pointer/keyboard completion inside this conversation, preserving native secondary-click Copy and the editor caret.
  useEffect(() => {
    const inToolbar = (event: Event) =>
      event.target instanceof Element && event.target.closest(".ob-chat-selection-layer");
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0 && !inToolbar(event)) dismiss();
    };
    const pointerUp = (event: PointerEvent) => {
      if (!inToolbar(event)) capture();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
      else if (!inToolbar(event)) capture();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (selection && botQuoteShortcut(event, mac)) {
        event.preventDefault();
        quote();
      }
    };
    window.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("keydown", keyDown);
    return () => {
      window.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("keydown", keyDown);
    };
  }, [capture, dismiss, mac, quote, selection]);
  if (props.disabled && selection) setSelection(null);
  if (!selection || props.disabled) return null;
  return (
    <BotSelectionBar
      key={`${selection.messageId}:${selection.text}`}
      selection={selection}
      mac={mac}
      onQuote={quote}
      onDetach={dismiss}
      onSend={props.onSend}
    />
  );
}
function BotSelectionBar({
  selection,
  mac,
  onQuote,
  onDetach,
  onSend,
}: {
  selection: MessageTextSelection;
  mac: boolean;
  onQuote: () => void;
  onDetach: () => void;
  onSend: (messageId: string, body: string) => Promise<boolean>;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"idle" | "sending" | "error">("idle");
  const [lastInstruction, setLastInstruction] = useState("");
  const [barWidth, setBarWidth] = useState<number | null>(null);
  const [typingWidth, setTypingWidth] = useState<number | null>(null);
  const hasPrompt = prompt.trim().length > 0;
  const serialize = (instruction: string) =>
    botFileQuoteTarget(selection.messageId)
      ? serializeBotFileSelectionInstruction(instruction, selection.text, selection.messageId)
      : serializeBotSelectionInstruction(instruction, selection.text);
  const maximumInstructionLength = Math.max(1, 100000 - serialize("").length);
  const updatePrompt = (value: string) => {
    if (!hasPrompt && value.trim() && bar.current) {
      const width = Math.ceil(bar.current.getBoundingClientRect().width);
      setTypingWidth(width);
      setBarWidth(width);
    } else if (!value.trim()) setTypingWidth(null);
    setPrompt(value);
  };
  const submit = async (instruction: string) => {
    const normalized = instruction.trim();
    if (!normalized || sending.current) return;
    setLastInstruction(normalized);
    const body = serialize(normalized);
    if (body.length > 100000) {
      setMode("error");
      return;
    }
    sending.current = true;
    setExpanded(false);
    setMode("sending");
    const settled = await settlePromise(async () => {
      if (await onSend(selection.messageId, body)) onDetach();
      else setMode("error");
    });
    if (settled._tag === "Failure") setMode("error");
    sending.current = false;
  };
  const measureWidth = useStableCallback(() => {
    if (!content.current) return;
    const width =
      mode === "idle" && hasPrompt && typingWidth !== null
        ? typingWidth
        : Math.ceil(content.current.scrollWidth) + 8;
    setBarWidth(Math.max(44, Math.min(window.innerWidth - 24, width)));
  });

  const [geometry, setGeometry] = useState<{
    rects: SelectionRect[];
    position: ReturnType<typeof botSelectionPosition>;
    fallback: boolean;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source popover follows the live Range, viewport and scrolling. Preserve the passage highlight while focus moves into its action, with rect fallback for engines without CSS Highlights.
  useEffect(() => {
    let frame = 0;
    let widthFrame = 0;
    let highlight: Highlight | null = null;
    try {
      highlight = new Highlight(selection.range);
      CSS.highlights.set("ob-chat-message-selection", highlight);
    } catch {
      highlight = null;
    }
    const update = () => {
      frame = 0;
      if (!selection.range.startContainer.isConnected) {
        onDetach();
        return;
      }
      if (!bar.current) return;
      const unique = new Map<string, DOMRect>();
      for (const rect of selection.range.getClientRects())
        if (rect.width > 0)
          unique.set(`${rect.top}:${rect.left}:${rect.width}:${rect.height}`, rect);
      const rects = [...unique.values()];
      if (!rects.length) {
        onDetach();
        return;
      }
      setGeometry({
        rects,
        fallback: !highlight,
        position: botSelectionPosition(rects, bar.current.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      });
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const stopBar = bar.current ? observeResize(bar.current, schedule) : () => {};
    const stopContent = content.current
      ? observeResize(content.current, () => {
          cancelAnimationFrame(widthFrame);
          widthFrame = requestAnimationFrame(() => {
            measureWidth();
            schedule();
          });
        })
      : () => {};
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(widthFrame);
      stopBar();
      stopContent();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (highlight && CSS.highlights.get("ob-chat-message-selection") === highlight)
        CSS.highlights.delete("ob-chat-message-selection");
    };
  }, [selection, onDetach, measureWidth]);
  return createPortal(
    <>
      {geometry?.fallback && (
        <div className="openbot-react ob-chat-selection-highlight" aria-hidden="true">
          {geometry.rects.map((rect) => (
            <span
              key={`${rect.top}:${rect.left}:${rect.width}:${rect.height}`}
              style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            />
          ))}
        </div>
      )}
      <div
        className="openbot-react ob-chat-selection-layer"
        data-placement={geometry?.position.placement}
        data-ready={geometry ? "true" : undefined}
        style={{ top: geometry?.position.top ?? 0, left: geometry?.position.left ?? 0 }}
      >
        <div
          ref={bar}
          className="ob-chat-selection-bar"
          role="toolbar"
          aria-label="Selected text actions"
          style={{ width: barWidth ?? undefined }}
        >
          <div
            ref={content}
            className="ob-chat-selection-content"
            style={{
              width:
                mode === "idle" && hasPrompt && typingWidth !== null
                  ? Math.max(1, typingWidth - 8)
                  : undefined,
            }}
          >
            {mode === "sending" && (
              <span className="ob-chat-selection-status" role="status">
                <span className="ob-chat-selection-spinner" aria-hidden="true" />
                Sending…
              </span>
            )}
            {mode === "error" && (
              <>
                <span className="ob-chat-selection-error" role="alert">
                  Couldn’t send
                </span>
                <button
                  type="button"
                  className="ob-chat-selection-control"
                  onPointerDown={preserveSelection}
                  onClick={() => void submit(lastInstruction)}
                >
                  <RetryIcon />
                  <span className="ob-chat-selection-label">Retry</span>
                </button>
                <button
                  type="button"
                  className="ob-chat-selection-icon-button"
                  aria-label="Close selected text actions"
                  onPointerDown={preserveSelection}
                  onClick={onDetach}
                >
                  <CloseSelectionIcon />
                </button>
              </>
            )}
            {mode === "idle" && (
              <>
                <div
                  className={`ob-chat-selection-form-shell${expanded ? " ob-chat-selection-form-shell-hidden" : ""}`}
                  inert={expanded}
                  style={{
                    maxWidth: expanded
                      ? 0
                      : hasPrompt && typingWidth !== null
                        ? Math.max(1, typingWidth - 40)
                        : 145,
                  }}
                >
                  <form
                    className="ob-chat-selection-form"
                    style={{
                      width:
                        hasPrompt && typingWidth !== null ? Math.max(1, typingWidth - 40) : 145,
                    }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit(prompt);
                    }}
                  >
                    <input
                      value={prompt}
                      aria-label="Describe edits"
                      placeholder="Describe edits"
                      maxLength={maximumInstructionLength}
                      onChange={(event) => updatePrompt(event.currentTarget.value)}
                    />
                  </form>
                </div>
                <div
                  className={`ob-chat-selection-presets${hasPrompt ? " ob-chat-selection-presets-hidden" : ""}${expanded ? " ob-chat-selection-presets-expanded" : ""}`}
                  inert={hasPrompt}
                  aria-hidden={hasPrompt ? true : undefined}
                  style={{ maxWidth: hasPrompt ? 0 : (expanded ? 462 : 224) + 84 }}
                >
                  {!expanded && <span className="ob-chat-selection-divider" aria-hidden="true" />}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="ob-chat-selection-control"
                          aria-label="Quote selected text"
                          aria-keyshortcuts={mac ? "Meta+Shift+Period" : "Control+Shift+Period"}
                          onPointerDown={preserveSelection}
                          onClick={onQuote}
                        />
                      }
                    >
                      <TextQuoteIcon className="ob-chat-selection-icon" aria-hidden="true" />
                      <span className="ob-chat-selection-label">Quote</span>
                    </TooltipTrigger>
                    <TooltipPopup side="top">{mac ? "⌘⇧." : "Ctrl+Shift+."}</TooltipPopup>
                  </Tooltip>
                  <Preset
                    label="Explain"
                    icon={<ExplainIcon />}
                    onSelect={() => void submit(selectionActionInstructions.Explain)}
                  />
                  <Preset
                    label="Improve"
                    icon={<ImproveIcon />}
                    onSelect={() => void submit(selectionActionInstructions.Improve)}
                  />
                  {expanded && (
                    <div className="ob-chat-selection-more-presets">
                      <Preset
                        label="Shorten"
                        icon={<ShortenIcon />}
                        onSelect={() => void submit(selectionActionInstructions.Shorten)}
                      />
                      <Preset
                        label="Tone"
                        icon={<ToneIcon />}
                        onSelect={() => void submit(selectionActionInstructions.Tone)}
                      />
                      <Preset
                        label="Grammar"
                        icon={<GrammarIcon />}
                        onSelect={() => void submit(selectionActionInstructions.Grammar)}
                      />
                    </div>
                  )}
                  <span
                    className="ob-chat-selection-divider ob-chat-selection-more-divider"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="ob-chat-selection-icon-button ob-chat-selection-expand"
                    aria-label={expanded ? "Show fewer actions" : "Show more actions"}
                    aria-expanded={expanded}
                    onPointerDown={preserveSelection}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    <ChevronIcon />
                  </button>
                </div>
                <div
                  className={`ob-chat-selection-send-shell${hasPrompt ? " ob-chat-selection-send-shell-visible" : ""}`}
                  aria-hidden={hasPrompt ? undefined : true}
                >
                  <button
                    type="button"
                    className="ob-chat-selection-send"
                    aria-label="Send edit instruction"
                    tabIndex={hasPrompt ? undefined : -1}
                    onPointerDown={preserveSelection}
                    onClick={() => void submit(prompt)}
                  >
                    <SendIcon />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function preserveSelection(event: ReactPointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}
function Preset({
  label,
  icon,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="ob-chat-selection-control"
      aria-label={label}
      onPointerDown={preserveSelection}
      onClick={onSelect}
    >
      {icon}
      <span className="ob-chat-selection-label">{label}</span>
    </button>
  );
}
function SelectionIcon(props: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="ob-chat-selection-icon">
      {props.children}
    </svg>
  );
}

function ExplainIcon() {
  return (
    <SelectionIcon>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M8.2 8.1a1.9 1.9 0 0 1 3.7.55c0 1.5-1.9 1.65-1.9 3M10 14.2h.01" />
    </SelectionIcon>
  );
}

function ImproveIcon() {
  return (
    <SelectionIcon>
      <path d="m10 2.9 1.1 4.2L15.3 8l-4.2 1.1-1.1 4.2-1.1-4.2L4.7 8l4.2-.9zM15.2 12.5l.5 1.8 1.8.5-1.8.5-.5 1.8-.5-1.8-1.8-.5 1.8-.5z" />
    </SelectionIcon>
  );
}

function ShortenIcon() {
  return (
    <SelectionIcon>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="14" r="2.2" />
      <path d="m7.8 7.2 7 5.6M7.8 12.8l7-5.6" />
    </SelectionIcon>
  );
}

function ToneIcon() {
  return (
    <SelectionIcon>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M7.2 8h.01M12.8 8h.01M7.1 11.5c.8 1.15 1.77 1.7 2.9 1.7s2.1-.55 2.9-1.7" />
    </SelectionIcon>
  );
}

function GrammarIcon() {
  return (
    <SelectionIcon>
      <rect x="3.5" y="4" width="13" height="12" rx="2" />
      <path d="M6.5 8h7M6.5 11h5M6.5 14h3" />
    </SelectionIcon>
  );
}

function ChevronIcon() {
  return (
    <SelectionIcon>
      <path d="m8 5 5 5-5 5" />
    </SelectionIcon>
  );
}

function SendIcon() {
  return (
    <SelectionIcon>
      <path d="M10 15.5v-11M5.7 8.8 10 4.5l4.3 4.3" />
    </SelectionIcon>
  );
}

function RetryIcon() {
  return (
    <SelectionIcon>
      <path d="M15 7.2A5.7 5.7 0 1 0 15.4 12M15 3.9v3.7h-3.7" />
    </SelectionIcon>
  );
}

function CloseSelectionIcon() {
  return (
    <SelectionIcon>
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </SelectionIcon>
  );
}
