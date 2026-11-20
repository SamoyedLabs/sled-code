type TaskRefreshPorts<List, Conversation> = {
  list(agentId: string): Promise<List>;
  read(agentId: string, taskId: string): Promise<Conversation>;
  listChanged(hostId: string, snapshot: List): void;
  conversationChanged(hostId: string, taskId: string, snapshot: Conversation): void;
};

/** Refresh only task views requested by this workspace, including the host-wide Tasks page. */
export function createWorkspaceTaskRefresh<List, Conversation>(
  ports: TaskRefreshPorts<List, Conversation>,
) {
  const lists = new Set<string>();
  const conversations = new Map<string, string>();
  let generation = 0;
  return {
    observeList(agentId: string) {
      lists.add(agentId);
    },
    observeConversation(agentId: string, taskId: string) {
      conversations.set(taskId, agentId);
    },
    clear() {
      generation++;
      lists.clear();
      conversations.clear();
    },
    async refresh(hostId: string, selectedAgent: string | null, current: () => boolean) {
      const started = generation;
      const live = () => generation === started && current();
      const agents = new Set([
        ...lists,
        ...conversations.values(),
        ...(selectedAgent ? [selectedAgent] : []),
      ]);
      for (const agentId of agents) {
        if (!live()) return;
        const snapshot = await ports.list(agentId);
        if (!live()) return;
        ports.listChanged(hostId, snapshot);
      }
      for (const [taskId, agentId] of conversations) {
        if (!live()) return;
        const snapshot = await ports.read(agentId, taskId);
        if (!live()) return;
        ports.conversationChanged(hostId, taskId, snapshot);
      }
    },
  };
}
