import Constants from "expo-constants";

import { usesDarkMobileMascot } from "./mobileBranding";

const variant = Constants.expoConfig?.extra?.appVariant;

export const darkMascot = usesDarkMobileMascot(variant);
