/* oxlint-disable shadcn/no-unknown-classes -- Original AgentRoutinesSettings list selectors are supplied by source CSS. */
import { CircleCheck, Clock3, Link, Plus } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { SourceButton } from "./SettingsParts";
import { SourceSwitch } from "./SourceSwitch";
import { SettingsPanelContent } from "./SettingsPanel";
import "./agent-settings.css";
export interface AgentRoutineRow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  completed: boolean;
  triggerKind: "schedule" | "webhook";
  summary: string;
}
export function AgentRoutinesList({
  routines,
  loading,
  loadError,
  onBack,
  onCreate,
  onOpen,
  onSetActive,
  onRetry,
  editor,
}: {
  routines: readonly AgentRoutineRow[];
  loading: boolean;
  loadError?: string | null;
  onBack: () => void;
  onCreate?: (() => void) | undefined;
  onOpen: (routine: AgentRoutineRow) => void;
  onSetActive?: ((id: string, active: boolean) => Promise<void>) | undefined;
  onRetry?: () => void;
  editor?: ReactNode;
}) {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const locks = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const toggle = async (routine: AgentRoutineRow, active: boolean) => {
    if (!onSetActive || routine.completed || locks.current.has(routine.id)) return;
    locks.current.add(routine.id);
    setPending(new Set(locks.current));
    setError(null);
    try {
      await onSetActive(routine.id, active);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the routine.");
    } finally {
      locks.current.delete(routine.id);
      setPending(new Set(locks.current));
    }
  };
  const listed = [...routines].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.createdAt > b.createdAt
        ? -1
        : 1,
  );
  if (editor !== undefined) return editor;
  return (
    <div className="agent-routines-settings">
      <header className="settings-panel-header agent-routines-header">
        <SourceButton
          variant="ghost"
          className="settings-panel-nav-button"
          aria-label="Back to settings"
          onClick={onBack}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="ui-glyph-20 settings-back-icon"
            fill="none"
            stroke="currentColor"
          >
            <path d="m12.5 4-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </SourceButton>
        <div className="agent-routines-heading">
          <h2>Routines</h2>
        </div>
        <SourceButton
          variant="ghost"
          className="settings-panel-nav-button"
          aria-label="Create Routine"
          disabled={!onCreate}
          onClick={onCreate}
        >
          <Plus aria-hidden="true" />
        </SourceButton>
      </header>
      <SettingsPanelContent>
        <div className="agent-routines-list-view">
          {loading ? (
            <p className="agent-routines-empty" role="status">
              Loading routines…
            </p>
          ) : loadError ? (
            <p className="agent-routines-empty" role="alert">
              {loadError}
              {onRetry && <SourceButton onClick={onRetry}>Retry</SourceButton>}
            </p>
          ) : listed.length === 0 ? (
            <p className="agent-routines-empty">No routines yet.</p>
          ) : (
            <div className="agent-routines-list">
              {listed.map((routine) => (
                <div key={routine.id} className="ui-item-group agent-routine-card">
                  <div className="agent-routine-list-item">
                    <SourceButton
                      variant="ghost"
                      className="agent-routine-row"
                      onClick={() => onOpen(routine)}
                    >
                      <span
                        className={
                          routine.active
                            ? "agent-routine-status-icon-active"
                            : "agent-routine-status-icon-paused"
                        }
                      >
                        {routine.completed ? (
                          <CircleCheck aria-hidden="true" />
                        ) : routine.triggerKind === "webhook" ? (
                          <Link aria-hidden="true" />
                        ) : (
                          <Clock3 aria-hidden="true" />
                        )}
                      </span>
                      <span>
                        <strong>{routine.name}</strong>
                        <small>
                          {routine.completed ? `Completed · ${routine.summary}` : routine.summary}
                        </small>
                      </span>
                    </SourceButton>
                    <SourceSwitch
                      label={routine.name}
                      checked={routine.active}
                      disabled={!onSetActive || routine.completed || pending.has(routine.id)}
                      onChange={(active) => void toggle(routine, active)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="agent-settings-save-error">
              {error}
            </p>
          )}
        </div>
      </SettingsPanelContent>
    </div>
  );
}
