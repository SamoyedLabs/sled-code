import { memo } from "react";
import { View } from "react-native";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { BotAvatar } from "./BotAvatar";
import { useBotPalette } from "./BotChrome";

type Member = { readonly agentId: string };
type Avatar = { readonly avatarSeed?: string; readonly avatarHue?: number | null };

// OpenBot mobile's channel-avatar.tsx layout with Sled's Bloub renderer.
export const GroupAvatar = memo(function GroupAvatar({
  members,
  agents,
  size,
}: {
  members: readonly Member[];
  agents: ReadonlyMap<string, Avatar>;
  size: number;
}) {
  const visible = members.slice(0, 4);
  const palette = useBotPalette();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        flexDirection: "row",
        flexWrap: "wrap",
        alignContent: "center",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {visible.length === 0 && (
        <SymbolView name="folder" size={size * 0.56} tintColor={palette.muted} />
      )}
      {visible.map(({ agentId }) => {
        const agent = agents.get(agentId);
        return (
          <BotAvatar
            key={agentId}
            seed={agent?.avatarSeed ?? agentId}
            hue={agent?.avatarHue ?? null}
            size={(size - 6) / 2}
          />
        );
      })}
    </View>
  );
});
