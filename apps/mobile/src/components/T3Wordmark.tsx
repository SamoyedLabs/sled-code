import type { ColorValue } from "react-native";
import { Image } from "expo-image";
import { T3_CODE_BRAND_MARK_SOURCE } from "./brandAssets";

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Image
      source={T3_CODE_BRAND_MARK_SOURCE}
      accessibilityLabel="Sled"
      style={{ width: props.height, height: props.height }}
    />
  );
}
