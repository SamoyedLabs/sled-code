import * as Schema from "effect/Schema";
const decodeTasks = Schema.decodeUnknownOption(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({ id: Schema.NonEmptyString, threadId: Schema.NullOr(Schema.String) }),
    ),
  }),
);
export function resolveConversationThread(
  conversationId: string,
  mainThreadId: string | null,
  tasks: unknown,
): { taskId: string | null } | null {
  if (conversationId === mainThreadId) return { taskId: null };
  const rows = decodeTasks(tasks);
  if (rows._tag === "None") return null;
  const matches = rows.value.tasks.filter((task) => task.threadId === conversationId);
  return matches.length === 1 ? { taskId: matches[0]!.id } : null;
}
