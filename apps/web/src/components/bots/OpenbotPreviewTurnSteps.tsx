import { BotTurnSteps } from "./BotTurnSteps";
import { useGT } from "gt-react";
export function OpenbotPreviewTurnSteps(props: Parameters<typeof BotTurnSteps>[0]) {
  const gt = useGT();
  return <BotTurnSteps {...props} sourceLabel={gt("Local sample turn")} llmCalls={0} />;
}
