/* oxlint-disable shadcn/no-unknown-classes -- The original picture editor shares the source avatar editor styles. */
import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Pencil, Plus, RotateCcw } from "lucide-react";
import type {
  EnvironmentId,
  OpenbotChannel,
  OpenbotAgent,
  OpenbotChannelAdminRequest,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { readPreparedConnection } from "../../../../state/session";
import { GroupAvatar, GroupIconTile, useGroupPicture } from "../../GroupAvatar";
import { SourceButton } from "../settings/SettingsParts";
import { normalizeAvatarFile, avatarImageDataUrl } from "../settings/avatar-image";
import { AVATAR_HUE_CHOICES, avatarHueSwatch } from "../settings/avatar-editor-model";
import { CHANNEL_ICONS } from "./channel-icons";
import "../settings/agent-settings.css";
import { AvatarEditorPopup } from "../settings/AvatarEditorPopup";
export function GroupPictureEditor({
  environmentId,
  hostId,
  channel,
  agents,
  onSaved,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  channel: OpenbotChannel;
  agents: readonly (typeof OpenbotAgent.Type)[];
  onSaved: () => void;
}) {
  const { picture, url, refresh } = useGroupPicture(channel.id);
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false }),
    permission = useAtomValue(openbot.adminToHost.permissionAtom(environmentId));
  const icon = picture?.icon,
    hue = icon?.hue ?? 55;
  type Picture = Extract<
    OpenbotChannelAdminRequest,
    { operation: "channel.picture.set" }
  >["picture"];
  const save = async (value: Picture) => {
    if (lock.current || !permission) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const connection = readPreparedConnection(environmentId);
    try {
      const result = await admin({
        environmentId,
        input: {
          hostId,
          request: { operation: "channel.picture.set", channelId: channel.id, picture: value },
        },
      });
      if (readPreparedConnection(environmentId) !== connection) return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      refresh();
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the group picture.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const disabled = busy || !permission;
  return (
    <div className="agent-settings-avatar-picker">
      <Popover.Root>
        <Popover.Trigger
          className="channel-picture-trigger"
          aria-label="Edit group picture"
          disabled={disabled}
        >
          <GroupAvatar
            channelId={channel.id}
            members={channel.members}
            agents={agents}
            layout="cluster"
            size={62}
          />
          <span className="agent-settings-avatar-badge" aria-hidden="true">
            <Pencil className="agent-settings-avatar-badge-icon" />
          </span>
        </Popover.Trigger>
        <AvatarEditorPopup title="Group picture" className="channel-picture-editor">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            aria-label="Choose group picture"
            disabled={disabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file || lock.current) return;
              void (async () => {
                try {
                  const image = await normalizeAvatarFile(file);
                  const data = avatarImageDataUrl(image);
                  await save({
                    kind: "image",
                    image: {
                      mimeType: image.mimeType,
                      dataBase64: data.slice(data.indexOf(",") + 1),
                    },
                  });
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "Could not process the picture.",
                  );
                }
              })();
            }}
          />
          <div className="avatar-editor-heading">
            <span>Image</span>
            <div className="avatar-editor-actions">
              {url && (
                <SourceButton
                  disabled={disabled}
                  onClick={() => void save({ kind: "remove-image" })}
                >
                  Remove
                </SourceButton>
              )}
            </div>
          </div>
          <SourceButton
            variant="ghost"
            className={`avatar-image-upload${url ? " avatar-image-upload-active" : ""}`}
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <span className="avatar-image-upload-preview">
              {url ? (
                <img
                  className="channel-picture channel-picture-image"
                  src={url}
                  alt=""
                  draggable={false}
                />
              ) : (
                <Plus />
              )}
            </span>
            <span>
              <strong>{url ? "Change image" : "Upload image"}</strong>
              <small>PNG, JPEG, GIF, or WebP</small>
            </span>
          </SourceButton>
          <div className="avatar-editor-divider" />
          <div className="avatar-editor-heading">
            <span>Icon</span>
            <div className="avatar-editor-actions">
              {(url || icon) && (
                <SourceButton
                  variant="outline"
                  aria-label="Show member faces"
                  disabled={disabled}
                  onClick={() => void save({ kind: "reset" })}
                >
                  <RotateCcw />
                </SourceButton>
              )}
            </div>
          </div>
          <fieldset
            className="avatar-face-grid channel-icon-grid"
            aria-label="Icons"
            disabled={disabled}
          >
            {Object.entries(CHANNEL_ICONS).map(([name]) => (
              <button
                key={name}
                className="avatar-face-choice"
                type="button"
                aria-label={name}
                aria-pressed={!url && icon?.name === name}
                onClick={() => void save({ kind: "icon", icon: { name, hue } })}
              >
                <GroupIconTile name={name} hue={hue} />
              </button>
            ))}
          </fieldset>
          <div className="avatar-editor-divider" />
          <fieldset className="avatar-color-grid" aria-label="Group color" disabled={disabled}>
            {AVATAR_HUE_CHOICES.map((choice) => (
              <button
                key={choice.hue}
                type="button"
                className="avatar-color-choice"
                aria-label={`${choice.label} group color`}
                aria-pressed={!url && icon?.hue === choice.hue}
                style={{ background: avatarHueSwatch(choice.hue) }}
                onClick={() =>
                  void save({
                    kind: "icon",
                    icon: { name: icon?.name ?? "star", hue: choice.hue },
                  })
                }
              />
            ))}
          </fieldset>
          {error && <p role="alert">{error}</p>}
        </AvatarEditorPopup>
      </Popover.Root>
    </div>
  );
}
