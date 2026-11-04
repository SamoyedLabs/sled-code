import Constants from "expo-constants";
import { Platform } from "react-native";
import { supportsAndroidAgentNotifications } from "./androidNotifications";

export function isAgentAwarenessEnabled() {
  return Constants.expoConfig?.extra?.sledConnectNotifications === true;
}

export function supportsAgentAwarenessPush() {
  if (!isAgentAwarenessEnabled()) return false;
  return Platform.OS === "android"
    ? supportsAndroidAgentNotifications()
    : Platform.OS === "ios" && Constants.expoConfig?.extra?.iosPersonalTeamBuild !== true;
}
