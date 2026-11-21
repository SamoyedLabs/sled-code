import {
  MOBILE_CHAT_ORDERS,
  type MobileChatOrder,
} from "./upstream/openbot-mobile/workspace/sidebar-layout";

export const BOT_ROSTER_ORDERS = MOBILE_CHAT_ORDERS;
export type BotRosterOrder = MobileChatOrder;
export const DEFAULT_BOT_ROSTER_ORDER: BotRosterOrder = "unread-group";
export const BOT_ROSTER_ORDER_LABELS: Record<BotRosterOrder, string> = {
  manual: "Manual",
  recent: "Recent activity",
  "unread-group": "Unread in a group",
  "unread-first": "Unread first in folders",
};
