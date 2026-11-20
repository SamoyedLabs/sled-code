import type { OpenbotPerson } from "@t3tools/contracts";
import { BotAvatar } from "../avatar/BotAvatar";
export function SourcePersonAvatar({
  member,
  size = 34,
}: {
  member: OpenbotPerson;
  size?: number;
}) {
  return (
    <span
      className={`person-avatar${size === 48 ? " large" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <BotAvatar seed={member.email ?? member.username ?? member.id} size={size} mood="idle" />
    </span>
  );
}
