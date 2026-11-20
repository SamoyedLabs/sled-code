/* oxlint-disable shadcn/no-unknown-classes -- Original SettingsVoiceTab selectors are supplied by source CSS. */
import { useRef, useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { SettingsCard, SettingsRow, SettingsSection, SourceButton } from "./SettingsParts";
import { SourceSwitch } from "./SourceSwitch";

export interface VoiceModelPresentation {
  id: string;
  name: string;
  description: string;
  kind: "local" | "cloud";
  phase: "missing" | "downloading" | "ready" | "error";
  status: string;
  progress?: number;
  inUse: boolean;
  credential?: ReactNode;
}
export interface VoiceModelActions {
  download?: (id: string) => Promise<void>;
  cancel?: (id: string) => Promise<void>;
  remove?: (id: string) => Promise<void>;
  use?: (id: string) => Promise<void>;
}
function VoiceModelRow({
  model,
  actions,
}: {
  model: VoiceModelPresentation;
  actions: VoiceModelActions;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const act = async (action: ((id: string) => Promise<void>) | undefined) => {
    if (!action || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action(model.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change the voice model. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="ui-item settings-modal-row" data-size="default">
      <div className="ui-item-content">
        <div className="ui-item-title">{model.name}</div>
        <div className="ui-item-description">{model.description}</div>
        <div className="ui-item-description" aria-live="polite">
          {model.status}
        </div>
        {model.phase === "downloading" && (
          <div
            className="ui-progress"
            role="progressbar"
            aria-valuenow={model.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Downloading ${model.name}`}
          >
            <div className="ui-progress-track">
              <div
                className="ui-progress-fill"
                data-indeterminate={model.progress === undefined ? "" : undefined}
                style={
                  model.progress === undefined
                    ? undefined
                    : { width: `${Math.max(0, Math.min(100, model.progress))}%` }
                }
              />
            </div>
          </div>
        )}
        {model.credential}
        {error && (
          <p role="alert" className="settings-modal-error">
            {error}
          </p>
        )}
      </div>
      <div className="ui-item-actions">
        {model.inUse && (
          <span className="z-badge z-badge-variant-secondary" data-variant="secondary">
            In use
          </span>
        )}
        {model.kind === "local" && model.phase === "missing" && (
          <SourceButton
            disabled={busy || !actions.download}
            aria-label={`Download ${model.name}`}
            onClick={() => void act(actions.download)}
          >
            <Download aria-hidden="true" />
            Download
          </SourceButton>
        )}
        {model.phase === "downloading" && (
          <SourceButton
            variant="ghost"
            disabled={busy || !actions.cancel}
            aria-label={`Stop the download of ${model.name}`}
            onClick={() => void act(actions.cancel)}
          >
            Cancel
          </SourceButton>
        )}
        {model.phase === "error" && (
          <SourceButton
            disabled={busy || !actions.download}
            onClick={() => void act(actions.download)}
          >
            <RefreshCw aria-hidden="true" />
            Try again
          </SourceButton>
        )}
        {model.phase === "ready" && !model.inUse && actions.use && (
          <SourceButton
            disabled={busy}
            aria-label={`Use ${model.name} for dictation`}
            onClick={() => void act(actions.use)}
          >
            Use
          </SourceButton>
        )}
        {model.phase === "ready" && actions.remove && (
          <SourceButton
            variant="ghost"
            disabled={busy}
            aria-label={`Remove ${model.name} from this computer`}
            onClick={() => void act(actions.remove)}
          >
            {model.kind === "cloud" ? "Remove key" : "Remove"}
          </SourceButton>
        )}
      </div>
    </div>
  );
}
export function SettingsVoice({
  models,
  modelActions,
  language,
  speech,
  server,
  error,
}: {
  models: readonly VoiceModelPresentation[];
  modelActions: VoiceModelActions;
  language: ReactNode;
  speech?: {
    model: VoiceModelPresentation;
    actions: VoiceModelActions;
    readReplies: boolean;
    saving?: boolean;
    onReadReplies: (checked: boolean) => void;
    voice?: ReactNode;
    speed: ReactNode;
  };
  server: ReactNode;
  error?: string | null;
}) {
  return (
    <>
      {error && (
        <p className="settings-modal-error" role="alert">
          {error}
        </p>
      )}
      <SettingsSection title="Dictation model">
        <SettingsCard>
          {models.map((model) => (
            <VoiceModelRow key={model.id} model={model} actions={modelActions} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Language">
        <SettingsCard>{language}</SettingsCard>
      </SettingsSection>
      {speech && (
        <SettingsSection title="Spoken replies">
          <SettingsCard>
            <VoiceModelRow model={speech.model} actions={speech.actions} />
            <SettingsRow
              title="Read replies aloud"
              description="When you dictate a message, the reply is read aloud. Dictate again to stop it."
            >
              <SourceSwitch
                label="Read replies aloud"
                checked={speech.readReplies}
                disabled={speech.saving ?? false}
                onChange={speech.onReadReplies}
              />
            </SettingsRow>
            {speech.voice}
            {speech.speed}
          </SettingsCard>
        </SettingsSection>
      )}
      <SettingsSection title="Voice server">
        <SettingsCard>{server}</SettingsCard>
      </SettingsSection>
    </>
  );
}
