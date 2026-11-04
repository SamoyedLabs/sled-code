import Constants from "expo-constants";

const variant = Constants.expoConfig?.extra?.appVariant;

/** Uses the installed app's channel, including distributed Dev/Nightly builds. */
export const darkMascot = variant === "development" || variant === "preview";
