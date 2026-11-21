import { StackActions, useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { Keyboard } from "react-native";

export function useReturnToCode() {
  const navigation = useNavigation();
  return useCallback(() => {
    Keyboard.dismiss();
    const state = navigation.getState();
    const code = state?.routes
      .slice(0, state.index)
      .findLast((route) => route.name === "Home" || route.name === "Thread");
    if (state && code) {
      navigation.dispatch({ ...StackActions.popTo(code.name, code.params), target: state.key });
    } else {
      navigation.navigate("Home");
    }
  }, [navigation]);
}
