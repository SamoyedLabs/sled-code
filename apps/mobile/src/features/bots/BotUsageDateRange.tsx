// Bots Home is iOS-only. Keep the native SwiftUI module out of the Android bundle.
export function BotUsageDateRange(
  _props: Parameters<typeof import("./BotUsageDateRange.ios").BotUsageDateRange>[0],
) {
  return null;
}
