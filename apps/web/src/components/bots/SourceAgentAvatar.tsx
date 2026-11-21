import { createContext, useContext, type ReactNode } from "react";
import * as Schema from "effect/Schema";
import type { EnvironmentId, OpenbotAgent } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { BotAvatar, type AvatarMood } from "./avatar/BotAvatar";
const Context = createContext<{ environmentId: EnvironmentId; hostId: string } | null>(null);
const decodeImage = Schema.decodeUnknownOption(
  Schema.Struct({
    mimeType: Schema.Literals(["image/png", "image/jpeg", "image/webp"]),
    dataBase64: Schema.String.check(
      Schema.isMaxLength(699052),
      Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/),
    ),
  }),
);
export function useSourceAvatarHost() {
  return useContext(Context);
}
export function SourceAgentAvatarHost({
  environmentId,
  hostId,
  children,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  children: ReactNode;
}) {
  return <Context.Provider value={{ environmentId, hostId }}>{children}</Context.Provider>;
}
export function useSourceAgentAvatarUrl(
  agent: Pick<typeof OpenbotAgent.Type, "id" | "avatarVersion">,
) {
  const scope = useContext(Context);
  const image = useEnvironmentQuery(
    scope && agent.avatarVersion
      ? openbot.readFromHost({
          environmentId: scope.environmentId,
          input: {
            hostId: scope.hostId,
            request: {
              operation: "agent.avatar.read",
              agentId: agent.id,
              version: agent.avatarVersion,
            },
          },
        })
      : null,
  );
  const decoded = decodeImage(image.data);
  return decoded._tag === "Some"
    ? `data:${decoded.value.mimeType};base64,${decoded.value.dataBase64}`
    : null;
}
export function SourceAgentAvatar({
  agent,
  size = 42,
  mood = "idle",
  workingFaces = false,
}: {
  agent: typeof OpenbotAgent.Type;
  size?: number;
  mood?: AvatarMood;
  workingFaces?: boolean;
}) {
  const url = useSourceAgentAvatarUrl(agent);
  return url ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%", flexShrink: 0 }}
    />
  ) : (
    <BotAvatar
      seed={agent.avatarSeed ?? agent.id}
      hue={agent.avatarHue ?? null}
      size={size}
      mood={mood}
      workingFaces={workingFaces}
    />
  );
}
