/* oxlint-disable shadcn/no-unknown-classes -- Original group picture selectors are supplied by scoped source CSS. */
import * as Schema from "effect/Schema";
import { OpenbotChannelPresentations, OpenbotChannelPictureImage } from "@t3tools/contracts";
import { useSourceAvatarHost } from "./SourceAgentAvatar";
import { useEnvironmentQuery } from "../../state/query";
import { readPreparedConnection } from "../../state/session";
import { openbot } from "../../state/openbot";
import { CHANNEL_ICONS } from "./upstream/channels/channel-icons";
import { COLOR_BY_ID } from "./avatar/vendor/bloub-engine";
import { botAvatarProfile } from "./avatar/avatar-profile";
import "./upstream/channels/channel-avatar.css";
const decodePresentations = Schema.decodeUnknownOption(OpenbotChannelPresentations),
  decodeImage = Schema.decodeUnknownOption(OpenbotChannelPictureImage);
function usePendingPictureData<T>(
  data: T | null,
  pending: boolean,
  key: string,
  connection: unknown,
) {
  const [snapshot, setSnapshot] = useState({ data, key, connection });
  const retained =
    pending && data === null && snapshot.key === key && snapshot.connection === connection
      ? snapshot.data
      : data;
  if (snapshot.data !== retained || snapshot.key !== key || snapshot.connection !== connection)
    setSnapshot({ data: retained, key, connection });
  return retained;
}

export function useGroupPicture(channelId: string | undefined) {
  const scope = useSourceAvatarHost();
  const query = useEnvironmentQuery(
    scope && channelId
      ? openbot.readFromHost({
          environmentId: scope.environmentId,
          input: { hostId: scope.hostId, request: { operation: "channel.presentation" } },
        })
      : null,
  );
  const identity = `${scope?.environmentId}:${scope?.hostId}:${channelId}`;
  const connection = scope ? readPreparedConnection(scope.environmentId) : null;
  const presentationData = usePendingPictureData(
    query.data,
    query.isPending && !query.error,
    identity,
    connection,
  );
  const decoded = decodePresentations(presentationData),
    picture =
      decoded._tag === "Some" ? decoded.value.find((item) => item.channelId === channelId) : null;
  const image = useEnvironmentQuery(
    scope && channelId && picture?.imageVersion
      ? openbot.readFromHost({
          environmentId: scope.environmentId,
          input: {
            hostId: scope.hostId,
            request: {
              operation: "channel.picture.read",
              channelId,
              version: picture.imageVersion,
            },
          },
        })
      : null,
  );
  const imageData = usePendingPictureData(
    image.data,
    image.isPending && !image.error && Boolean(picture?.imageVersion),
    `${identity}:${picture?.imageVersion}`,
    connection,
  );
  const value = decodeImage(imageData);
  return {
    picture,
    url:
      value._tag === "Some"
        ? `data:${value.value.mimeType};base64,${value.value.dataBase64}`
        : null,
    refresh: query.refresh,
  };
}
export function GroupIconTile({ name, hue }: { name: string; hue: number }) {
  const icon = Object.entries(CHANNEL_ICONS).find(([key]) => key === name)?.[1];
  if (!icon) return null;
  const Glyph = icon.component;
  return (
    <span
      className="channel-picture"
      style={
        {
          "--channel-picture-hue": COLOR_BY_ID.get(botAvatarProfile("channel", hue).color)?.hex,
        } as CSSProperties
      }
    >
      <Glyph aria-hidden="true" />
    </span>
  );
}
/* oxlint-disable shadcn/no-unknown-classes -- Original channel avatar selectors are defined in the imported group-avatar.css. */
import { useState, type CSSProperties } from "react";
import { UsersRoundIcon } from "lucide-react";
import { BotAvatar } from "./avatar/BotAvatar";
import "./group-avatar.css";

type Member = { agentId: string };
type Agent = {
  id: string;
  avatarSeed?: string | null | undefined;
  avatarHue?: number | null | undefined;
};

export function GroupAvatar({
  members,
  channelId,
  agents,
  layout = "row",
  size,
}: {
  channelId?: string | undefined;
  members: readonly Member[];
  agents: readonly Agent[];
  layout?: "row" | "cluster";
  size?: number;
}) {
  const { picture, url } = useGroupPicture(channelId);
  const [failed, setFailed] = useState<string | null>(null);
  const icon =
    picture?.icon && Object.hasOwn(CHANNEL_ICONS, picture.icon.name) ? picture.icon : null;
  if ((url && url !== failed) || icon)
    return (
      <span
        data-avatar-count="1"
        className={`channel-avatar channel-avatar-picture ${layout === "cluster" ? "channel-avatar-cluster" : ""}`}
        aria-hidden="true"
        style={size === undefined ? undefined : { width: size, height: size, flexShrink: 0 }}
      >
        {url && url !== failed ? (
          <img
            className="channel-picture channel-picture-image"
            src={url}
            alt=""
            draggable={false}
            onError={() => setFailed(url)}
          />
        ) : (
          icon && <GroupIconTile {...icon} />
        )}
      </span>
    );
  const cluster = layout === "cluster";
  const limit = !cluster ? 3 : members.length <= 4 ? 4 : members.length - 3 >= 10 ? 2 : 3;
  const shown = members.slice(0, limit);
  const hidden = members.length - shown.length;
  return (
    <span
      className="ob-group-avatar"
      data-layout={layout}
      data-avatar-count={Math.max(1, shown.length + (cluster && hidden > 0 ? 1 : 0))}
      aria-hidden="true"
      style={
        size === undefined ? undefined : ({ "--channel-avatar-size": `${size}px` } as CSSProperties)
      }
    >
      {members.length === 0 ? (
        <UsersRoundIcon className="ob-group-avatar-empty" />
      ) : (
        shown.map((member, index) => {
          const agent = agents.find((candidate) => candidate.id === member.agentId);
          return (
            <span
              className="ob-group-avatar-face"
              key={member.agentId}
              data-avatar-index={index + 1}
            >
              <BotAvatar
                seed={agent?.avatarSeed ?? member.agentId}
                hue={agent?.avatarHue ?? null}
                size={32}
              />
            </span>
          );
        })
      )}
      {cluster && hidden > 0 && <span className="ob-group-avatar-count">+{hidden}</span>}
    </span>
  );
}
