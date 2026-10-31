import { Platform, View } from "react-native";
import { AppText } from "../../components/ui/AppText";

// Platform file resolution keeps the Apple-only module out of Android builds.
export function RemoteDesktopRouteScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-screen p-6">
      <AppText>
        {Platform.OS === "ios"
          ? "Install a native build with remote desktop support."
          : "Remote desktop currently supports iPhone and iPad."}
      </AppText>
    </View>
  );
}
