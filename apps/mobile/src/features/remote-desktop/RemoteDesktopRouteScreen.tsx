import { useGT } from "gt-react-native";
import { Platform, View } from "react-native";
import { AppText } from "../../components/ui/AppText";

// Platform file resolution keeps the Apple-only module out of Android builds.
export function RemoteDesktopRouteScreen() {
  const gt = useGT();
  return (
    <View className="flex-1 items-center justify-center bg-screen p-6">
      <AppText>
        {Platform.OS === "ios"
          ? gt("Install a native build with remote desktop support.")
          : gt("Remote desktop currently supports iPhone and iPad.")}
      </AppText>
    </View>
  );
}
