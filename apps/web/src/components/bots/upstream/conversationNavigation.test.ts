import { expect, it } from "vite-plus/test";
import { resolveConversationThread } from "./conversationNavigation";
it("opens the actual main or task thread and refuses absent or ambiguous ownership", () => {
  const tasks = { tasks: [{ id: "task", threadId: "task-thread" }] };
  expect(resolveConversationThread("main-thread", "main-thread", tasks)).toEqual({ taskId: null });
  expect(resolveConversationThread("task-thread", "main-thread", tasks)).toEqual({
    taskId: "task",
  });
  expect(resolveConversationThread("foreign-thread", "main-thread", tasks)).toBeNull();
  expect(
    resolveConversationThread("task-thread", "main-thread", {
      tasks: [...tasks.tasks, { id: "other", threadId: "task-thread" }],
    }),
  ).toBeNull();
});
