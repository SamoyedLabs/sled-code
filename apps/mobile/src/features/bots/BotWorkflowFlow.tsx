import { useBotReducedMotion } from "./botFeedback";
import { workflowNodeTitle } from "@t3tools/client-runtime/openbot/presentation";
import type { OpenbotWorkflowGraph, OpenbotWorkflowStep } from "@t3tools/contracts";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { type FlowItem, type GraphPlace, workflowFlowTree } from "./upstream/workflow-flow-tree";
import { T, useGT } from "gt-react-native";

const cardWidth = 174;
const cardHeight = 74;
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const facet = (kind: string): { icon: AppSymbolName; name: string } => {
  switch (kind) {
    case "trigger":
      return { icon: "bolt.circle", name: "Trigger" };
    case "agent":
      return { icon: "person.crop.circle", name: "Bot" };
    case "llm":
      return { icon: "brain", name: "Model" };
    case "approval":
      return { icon: "checkmark.circle", name: "Approval" };
    case "condition":
      return { icon: "arrow.triangle.branch", name: "Condition" };
    case "output":
      return { icon: "arrow.up.right", name: "Output" };
    default:
      return {
        icon: "text.bubble",
        name: kind.length ? kind[0]!.toUpperCase() + kind.slice(1) : "Step",
      };
  }
};

function RunningArc({ color }: { color: string }) {
  const reduced = useBotReducedMotion();
  const phase = useSharedValue(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The running arc is animated entirely on the UI thread.
  useEffect(() => {
    if (!reduced)
      phase.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1));
    return () => cancelAnimation(phase);
  }, [phase, reduced]);
  const ring = useAnimatedProps(() => ({ strokeDashoffset: -470 * phase.get() }));
  return (
    <Svg
      width={cardWidth}
      height={cardHeight}
      style={{ position: "absolute" }}
      pointerEvents="none"
    >
      <AnimatedRect
        x={1}
        y={1}
        rx={14}
        width={cardWidth - 2}
        height={cardHeight - 2}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={[76, 394]}
        strokeLinecap="round"
        animatedProps={ring}
      />
    </Svg>
  );
}

export function BotWorkflowFlow({
  graph,
  selected,
  steps,
  onSelect,
  onAdd,
  onEdit,
  onRemove,
}: {
  graph: OpenbotWorkflowGraph;
  selected: string;
  steps?: readonly OpenbotWorkflowStep[];
  onSelect: (id: string) => void;
  onAdd?: (place: GraphPlace) => void;
  onEdit?: (id: string, action: "duplicate" | "move") => void;
  onRemove?: (id: string) => void;
}) {
  const gt = useGT();
  const palette = useBotPalette();
  const tree = useMemo(() => workflowFlowTree(graph), [graph]);
  const nodes = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const runSteps = useMemo(() => {
    const byNode = new Map<string, OpenbotWorkflowStep>();
    for (const step of steps ?? []) {
      if ((byNode.get(step.nodeId)?.attempt ?? 0) <= step.attempt) byNode.set(step.nodeId, step);
    }
    return byNode;
  }, [steps]);
  const connector = (width = 18) => (
    <View style={{ width, height: 1, backgroundColor: palette.border }} />
  );
  const card = (id: string) => {
    const node = nodes.get(id);
    if (!node) return null;
    const { icon, name } = facet(node.kind);
    const title = workflowNodeTitle(graph, id);
    const status = runSteps.get(id)?.status;
    const running = status === "running";
    const waiting = status === "approval";
    const active = selected === id;
    const border = waiting ? "#f59e0b" : active || running ? "#0a84ff" : palette.border;
    const body = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status ? `${title}, ${status}` : title}
        accessibilityState={{ selected: active }}
        onPress={() => onSelect(id)}
        style={{
          width: cardWidth,
          height: cardHeight,
          gap: 5,
          padding: 12,
          justifyContent: "center",
          borderWidth: 1,
          borderRadius: 14,
          borderCurve: "continuous",
          borderColor: border,
          backgroundColor: palette.surface,
        }}
      >
        {running && <RunningArc color="#7dc4ff" />}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <SymbolView name={icon} size={14} tintColor={waiting ? "#f59e0b" : palette.muted} />
          <Text style={{ color: palette.muted, fontSize: 11 }}>{status ?? name}</Text>
        </View>
        <Text numberOfLines={1} style={{ color: palette.text, fontSize: 15, fontWeight: "600" }}>
          {title}
        </Text>
      </Pressable>
    );
    if (!onEdit || !onRemove || node.locked) return body;
    return (
      <Menu
        shouldOpenOnLongPress
        actions={[
          { id: "move", title: gt("Move step") },
          { id: "duplicate", title: gt("Duplicate step") },
          { id: "delete", title: gt("Delete step"), attributes: { destructive: true } },
        ]}
        onPressAction={({ nativeEvent: { event } }) => {
          if (event === "delete") onRemove(id);
          if (event === "move" || event === "duplicate") onEdit(id, event);
        }}
      >
        {body}
      </Menu>
    );
  };
  const sequence = (items: readonly FlowItem[], pathKey: string) =>
    items.map((item) => {
      if (item.type === "step") return <View key={item.id}>{card(item.id)}</View>;
      if (item.type === "add") {
        const place = item.place;
        const key =
          place.kind === "edge" ? place.edgeId : `${place.nodeId}:${place.branch ?? "after"}`;
        if (!onAdd) return place.kind === "edge" ? <View key={key}>{connector(24)}</View> : null;
        return (
          <View key={key} style={{ flexDirection: "row", alignItems: "center" }}>
            {connector(12)}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                place.kind === "edge"
                  ? gt("Add step on connection")
                  : place.branch
                    ? gt("Add step to {branch} path", { branch: place.branch })
                    : gt("Add next step")
              }
              onPress={() => onAdd(place)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.control,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SymbolView name="plus" size={15} tintColor={palette.text} />
            </Pressable>
            {place.kind === "edge" && connector(12)}
          </View>
        );
      }
      if (item.type === "jump") {
        return (
          <Pressable
            key={`${item.from}:${item.to}`}
            accessibilityRole="button"
            onPress={() => onSelect(item.to)}
            style={{ minHeight: 42, justifyContent: "center", paddingHorizontal: 10 }}
          >
            <Text style={{ color: palette.muted, fontSize: 12 }}>
              {item.loop ? gt("Loop to") : gt("Go to")} {workflowNodeTitle(graph, item.to)}
            </Text>
          </Pressable>
        );
      }
      const chosen = runSteps.get(item.from)?.branch;
      return (
        <View
          key={`split:${item.from}`}
          style={{
            borderLeftWidth: 1,
            borderRightWidth: item.joined ? 1 : 0,
            borderColor: palette.border,
            marginHorizontal: 12,
            paddingHorizontal: 8,
            gap: 12,
          }}
        >
          {item.paths.map((path) => {
            const key = `${pathKey}:${item.from}:${path.key}`;
            return (
              <View
                key={key}
                style={{
                  gap: 6,
                  opacity: chosen && path.branch && chosen !== path.branch ? 0.38 : 1,
                }}
              >
                <Text style={{ color: palette.muted, fontSize: 12 }}>
                  {path.branch === "yes" ? gt("Yes") : path.branch === "no" ? gt("No") : gt("Path")}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {sequence(path.items, key)}
                  {path.goesOn && connector()}
                </View>
              </View>
            );
          })}
        </View>
      );
    });
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.canvas,
      }}
    >
      <ScrollView
        horizontal
        accessibilityLabel={steps ? gt("Workflow run flow") : gt("Workflow flow")}
        contentContainerStyle={{ gap: 18, padding: 14, minHeight: 132 }}
        keyboardShouldPersistTaps="handled"
      >
        {tree.items.length > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {sequence(tree.items, "root")}
          </View>
        )}
        {tree.loose.length > 0 && (
          <View style={{ alignSelf: "center", gap: 8 }}>
            <Text style={{ color: palette.muted, fontSize: 12 }}>
              <T>Unconnected steps</T>
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {tree.loose.map((id) => (
                <View key={id}>{card(id)}</View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
