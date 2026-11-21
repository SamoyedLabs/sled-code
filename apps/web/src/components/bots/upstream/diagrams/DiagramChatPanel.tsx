/* oxlint-disable shadcn/no-unknown-classes -- Original DiagramChatPanel selectors come from diagrams.css. */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { EnvironmentId, OpenbotAgent } from "@t3tools/contracts";
import { ArrowUp, Minimize2 } from "lucide-react";
import { SourceAgentAvatar } from "../../SourceAgentAvatar";
import { SourceButton } from "../settings/SettingsParts";
import { BotChatMarkdown } from "../../BotChatMarkdown";
import { BotDeferredMessageDetail } from "../../../settings/BotDeferredMessageDetail";
import { useRoutineAssistant } from "./useRoutineAssistant";
import type { DiagramPoint } from "./diagram-model";
import { T, Var, useGT } from "gt-react";
export function DiagramChatPanel({
  environmentId,
  hostId,
  agent,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agent: typeof OpenbotAgent.Type;
}) {
  const gt = useGT();
  const c = useRoutineAssistant(environmentId, hostId, agent.id);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(""),
    [offset, setOffset] = useState({ x: 0, y: 0 });
  const morph = useRef<HTMLDivElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    log = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const drag = useRef<{
      start: DiagramPoint;
      origin: DiagramPoint;
      bounds: DOMRect;
      area: DOMRect;
    } | null>(null),
    dragged = useRef(false);
  const start = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !morph.current) return;
    const box = morph.current.getBoundingClientRect(),
      area = morph.current.parentElement?.parentElement?.getBoundingClientRect();
    if (!area) return;
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: offset, bounds: box, area };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    let dx = e.clientX - d.start.x,
      dy = e.clientY - d.start.y;
    if (!dragged.current && Math.hypot(dx, dy) < 4) return;
    dragged.current = true;
    dx = Math.min(Math.max(dx, d.area.left - d.bounds.left), d.area.right - d.bounds.right);
    dy = Math.min(Math.max(dy, d.area.top - d.bounds.top), d.area.bottom - d.bounds.bottom);
    setOffset({ x: d.origin.x + dx, y: d.origin.y + dy });
  };
  const end = () => {
    drag.current = null;
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Focus follows the newly non-inert surface as the source chat morph opens or folds.
  useLayoutEffect(() => {
    if (open) input.current?.focus();
    else if (wasOpen.current) launcher.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Follow only new assistant messages or working-state changes, not unrelated canvas renders.
  useEffect(() => {
    if (c.messages.length === 0 && !c.working) return;
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [c.messages.length, c.working]);
  const send = () => {
    if (!draft.trim() || c.working || !c.canSend) return;
    void c.send(draft);
    setDraft("");
  };
  return (
    <div
      className="diagram-chat-morph"
      ref={morph}
      data-open={String(open)}
      data-diagram-overlay=""
      style={{ translate: `${offset.x}px ${offset.y}px` }}
    >
      <SourceButton
        ref={launcher}
        className="diagram-chat-launcher"
        aria-label={gt("Ask agent to change this flow")}
        aria-expanded={open}
        aria-hidden={open || undefined}
        tabIndex={open ? -1 : 0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          setOpen(true);
        }}
      >
        <SourceAgentAvatar agent={agent} size={24} />
        <T>Ask agent</T>
      </SourceButton>
      <section className="diagram-chat" aria-label={gt("Canvas assistant")} inert={!open}>
        <header
          className="diagram-chat-header"
          onPointerDown={(e) => {
            if (e.target instanceof Element && !e.target.closest("button")) start(e);
          }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <SourceAgentAvatar agent={agent} size={24} />
          <h2 className="diagram-chat-title">{agent.name}</h2>
          <SourceButton
            variant="ghost"
            aria-label={gt("Collapse canvas assistant")}
            onClick={() => setOpen(false)}
          >
            <Minimize2 />
          </SourceButton>
        </header>
        <div ref={log} className="diagram-chat-messages" role="log" aria-live="polite">
          {c.messages.length ? (
            c.messages.map((message) => (
              <div
                key={message.id}
                className={`ui-bubble diagram-chat-bubble ui-bubble-variant-${message.author === "user" ? "secondary" : "muted"}`}
                data-align={message.author === "user" ? "end" : "start"}
                data-author={message.author}
              >
                <div className="ui-bubble-content">
                  {message.author === "user" ? (
                    <p className="diagram-chat-text">{message.text}</p>
                  ) : (
                    <div className="diagram-chat-markdown">
                      <BotChatMarkdown
                        environmentId={environmentId}
                        hostId={hostId}
                        agentId={agent.id}
                        text={message.text}
                      />
                      {message.message?.deferredFields?.includes("text") && (
                        <BotDeferredMessageDetail
                          environmentId={environmentId}
                          hostId={hostId}
                          agentId={agent.id}
                          taskId={null}
                          messageId={message.id}
                          field="text"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="diagram-chat-empty">
              <T>
                Ask <Var>{agent.name}</Var> to create a routine or connect the agents in this flow.
              </T>
            </p>
          )}
          {c.working && (
            <p className="diagram-chat-working" role="status">
              <T>
                <Var>{agent.name}</Var> is working…
              </T>
            </p>
          )}
          {c.error && <p role="alert">{c.error}</p>}
        </div>
        <form
          className="composer diagram-chat-composer"
          data-compact=""
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="composer-input-label">
            <textarea
              ref={input}
              aria-label={gt("Message canvas assistant")}
              placeholder={gt("Describe a change…")}
              value={draft}
              maxLength={100000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>
          <div className="composer-primary-actions">
            <SourceButton
              type="submit"
              aria-label={gt("Send canvas request")}
              disabled={!draft.trim() || c.working || !c.canSend}
            >
              <ArrowUp />
            </SourceButton>
          </div>
        </form>
      </section>
    </div>
  );
}
