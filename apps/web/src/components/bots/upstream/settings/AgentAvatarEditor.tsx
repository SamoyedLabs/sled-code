/* oxlint-disable shadcn/no-unknown-classes -- Original AgentSettingsPanel avatar selectors are supplied by source CSS. */
import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Pencil, Plus, RotateCcw, Shuffle } from "lucide-react";
import { BotAvatar } from "../../avatar/BotAvatar";
import { SourceButton } from "./SettingsParts";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_HUE_CHOICES,
  SUPPORTED_AVATAR_SILHOUETTES,
  avatarHueForColor,
  avatarHueSwatch,
  avatarSeedForFace,
  bloubAvatarProfile,
  type AvatarHue,
  type BloubAvatarProfile,
} from "./avatar-editor-model";
import { normalizeAvatarFile, type AvatarImageInput } from "./avatar-image";
import "./agent-settings.css";
import { AvatarEditorPopup } from "./AvatarEditorPopup";
import { T, useGT } from "gt-react";

export interface AgentAvatarValue {
  id: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl?: string | null | undefined;
}
function Avatar({
  seed,
  hue,
  url,
}: {
  seed: string;
  hue: AvatarHue | null;
  url?: string | null | undefined;
}) {
  return (
    <span className={`agent-avatar${url ? " agent-avatar-custom" : ""}`}>
      {url ? <img src={url} alt="" /> : <BotAvatar seed={seed} hue={hue} size={62} />}
    </span>
  );
}
export function AgentAvatarEditor({
  agent,
  onUpdate,
  onSetAvatar,
}: {
  agent: AgentAvatarValue;
  onUpdate?:
    | ((patch: { avatarSeed?: string; avatarHue?: AvatarHue | null }) => Promise<void>)
    | undefined;
  onSetAvatar?: ((image: AvatarImageInput | null) => Promise<void>) | undefined;
}) {
  const gt = useGT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const face = bloubAvatarProfile(agent.avatarSeed, null);
  const shapeSeeds = SUPPORTED_AVATAR_SILHOUETTES.map((shape) => ({
    shape,
    seed: avatarSeedForFace(agent.id, { ...face, shape }),
  }));
  const expressionSeeds = AVATAR_EXPRESSIONS.map((expression) => ({
    expression,
    seed: avatarSeedForFace(agent.id, { ...face, expression }),
  }));
  const act = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(action);
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : gt("Could not save the agent avatar."));
    }
    lock.current = false;
    setBusy(false);
  };
  const generated = async (seed: string) => {
    if (!onUpdate) return;
    if (agent.avatarUrl) {
      if (!onSetAvatar) throw new Error("This host cannot remove the uploaded avatar.");
      await onSetAvatar(null);
    }
    await onUpdate({
      avatarSeed: seed,
      avatarHue: agent.avatarHue ?? avatarHueForColor(face.color),
    });
  };
  const randomFace = (): Pick<BloubAvatarProfile, "shape" | "expression"> => {
    const values = crypto.getRandomValues(new Uint32Array(2));
    return {
      shape: SUPPORTED_AVATAR_SILHOUETTES[(values[0] ?? 0) % SUPPORTED_AVATAR_SILHOUETTES.length]!,
      expression: AVATAR_EXPRESSIONS[(values[1] ?? 0) % AVATAR_EXPRESSIONS.length]!,
    };
  };
  return (
    <div className="agent-settings-avatar-picker">
      <Popover.Root>
        <Popover.Trigger className="agent-settings-avatar" aria-label={gt("Edit agent avatar")}>
          <Avatar seed={agent.avatarSeed} hue={agent.avatarHue} url={agent.avatarUrl} />
          <span className="agent-settings-avatar-badge" aria-hidden="true">
            <Pencil className="agent-settings-avatar-badge-icon" />
          </span>
        </Popover.Trigger>
        <AvatarEditorPopup title={gt("Avatar editor")}>
          <input
            ref={input}
            type="file"
            hidden
            aria-label={gt("Attach files")}
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file && onSetAvatar)
                void act(async () => onSetAvatar(await normalizeAvatarFile(file)));
            }}
          />
          <div className="avatar-editor-heading">
            <span>
              <T>Image</T>
            </span>
            <div className="avatar-editor-actions">
              {agent.avatarUrl && (
                <SourceButton
                  disabled={busy || !onSetAvatar}
                  onClick={() => void act(async () => onSetAvatar?.(null))}
                >
                  <T>Remove</T>
                </SourceButton>
              )}
            </div>
          </div>
          <SourceButton
            variant="ghost"
            className={`avatar-image-upload${agent.avatarUrl ? " avatar-image-upload-active" : ""}`}
            disabled={busy || !onSetAvatar}
            onClick={() => input.current?.click()}
          >
            <span className="avatar-image-upload-preview">
              {agent.avatarUrl ? (
                <Avatar seed={agent.avatarSeed} hue={agent.avatarHue} url={agent.avatarUrl} />
              ) : (
                <Plus aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>{agent.avatarUrl ? gt("Replace image") : gt("Upload image")}</strong>
              <small>
                <T>PNG, JPEG, GIF or WebP · square crop</T>
              </small>
            </span>
          </SourceButton>
          <div className="avatar-editor-divider" />
          <div className="avatar-editor-heading">
            <span>
              <T>Shape</T>
            </span>
            <div className="avatar-editor-actions">
              {agent.avatarSeed !== agent.id && (
                <SourceButton
                  disabled={busy || !onUpdate}
                  aria-label={gt("Reset to ID")}
                  onClick={() => void act(() => generated(agent.id))}
                >
                  <RotateCcw aria-hidden="true" />
                </SourceButton>
              )}
              <SourceButton
                disabled={busy || !onUpdate}
                aria-label={gt("Random face")}
                onClick={() => void act(() => generated(avatarSeedForFace(agent.id, randomFace())))}
              >
                <Shuffle aria-hidden="true" />
              </SourceButton>
            </div>
          </div>
          <fieldset className="avatar-face-grid avatar-shape-grid" aria-label={gt("Avatar shapes")}>
            {shapeSeeds.map(({ shape, seed }, index) => (
              <SourceButton
                key={shape}
                variant="ghost"
                className={`avatar-face-choice${!agent.avatarUrl && face.shape === shape ? " avatar-choice-selected" : ""}`}
                aria-label={gt("Shape {value}", { value: index + 1 })}
                aria-pressed={!agent.avatarUrl && face.shape === shape}
                disabled={busy || !onUpdate}
                onClick={() => void act(() => generated(seed))}
              >
                <Avatar seed={seed} hue={agent.avatarHue} />
              </SourceButton>
            ))}
          </fieldset>
          <div className="avatar-editor-divider" />
          <div className="avatar-editor-heading">
            <span>
              <T>Eyes</T>
            </span>
          </div>
          <fieldset className="avatar-face-grid avatar-eyes-grid" aria-label={gt("Avatar eyes")}>
            {expressionSeeds.map(({ expression, seed }, index) => (
              <SourceButton
                key={expression}
                variant="ghost"
                className={`avatar-face-choice${!agent.avatarUrl && face.expression === expression ? " avatar-choice-selected" : ""}`}
                aria-label={gt("Eyes {value}", { value: index + 1 })}
                aria-pressed={!agent.avatarUrl && face.expression === expression}
                disabled={busy || !onUpdate}
                onClick={() => void act(() => generated(seed))}
              >
                <Avatar seed={seed} hue={agent.avatarHue} />
              </SourceButton>
            ))}
          </fieldset>
          <div className="avatar-editor-divider" />
          <div className="avatar-editor-heading">
            <span>
              <T>Color</T>
            </span>
          </div>
          <fieldset className="avatar-color-grid" aria-label={gt("Avatar color")}>
            <SourceButton
              variant="ghost"
              className={`avatar-color-choice${agent.avatarHue === null ? " avatar-choice-selected" : ""}`}
              aria-label={gt("Automatic avatar color")}
              aria-pressed={agent.avatarHue === null}
              disabled={busy || !onUpdate}
              onClick={() => void act(async () => onUpdate?.({ avatarHue: null }))}
            >
              <span className="avatar-color-swatch avatar-color-swatch-auto">A</span>
            </SourceButton>
            {AVATAR_HUE_CHOICES.map((option) => {
              const selected =
                agent.avatarHue !== null &&
                avatarHueSwatch(agent.avatarHue) === avatarHueSwatch(option.hue);
              return (
                <SourceButton
                  key={option.hue}
                  variant="ghost"
                  className={`avatar-color-choice${selected ? " avatar-choice-selected" : ""}`}
                  aria-label={gt("{label} avatar color", { label: option.label })}
                  aria-pressed={selected}
                  disabled={busy || !onUpdate}
                  onClick={() => void act(async () => onUpdate?.({ avatarHue: option.hue }))}
                >
                  <span
                    className="avatar-color-swatch"
                    style={{ background: avatarHueSwatch(option.hue) }}
                  />
                </SourceButton>
              );
            })}
          </fieldset>
          {error && (
            <p className="agent-settings-save-error" role="alert">
              {error}
            </p>
          )}
        </AvatarEditorPopup>
      </Popover.Root>
    </div>
  );
}
