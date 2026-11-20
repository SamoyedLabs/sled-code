import { BotTurnSteps } from "./BotTurnSteps";
export function OpenbotPreviewTurnSteps(props: Parameters<typeof BotTurnSteps>[0]) {
  return <BotTurnSteps {...props} sourceLabel="Local sample turn" llmCalls={0} />;
}
