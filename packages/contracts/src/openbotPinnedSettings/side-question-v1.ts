// Adapted from pinned Openbot 0.60.0; see LICENSE.upstream. Event-only helpers omitted.
// Frozen optional side-question-v1 wire contract (stateless, no tools, max 20 prior turns).
// Bounds: 100k chars per question/answer, 32k per earlier answer; widening needs a new capability.
import {
  adminRoute,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  string,
} from "./admin-wire.ts";

export const SIDE_QUESTION_CAPABILITY = "side-question-v1";

export const SIDE_QUESTION_ROUTES = {
  ask: "/v1/side-questions/ask",
} as const;

/** The longest question and answer that cross the wire. */
export const SIDE_QUESTION_TEXT_LIMIT = 100_000;
/** The longest earlier answer: a client sends back only the start of a longer one. */
const EARLIER_ANSWER_LIMIT = 32_000;
const EARLIER_TURNS_LIMIT = 20;

export const SIDE_QUESTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    SIDE_QUESTION_ROUTES.ask,
    adminRoute(
      fields({
        agentId: identifier,
        question: string(SIDE_QUESTION_TEXT_LIMIT),
        earlier: list(
          fields({
            question: string(SIDE_QUESTION_TEXT_LIMIT),
            answer: string(EARLIER_ANSWER_LIMIT),
          }),
          EARLIER_TURNS_LIMIT,
        ),
      }),
      fields({ answer: string(SIDE_QUESTION_TEXT_LIMIT) }),
    ),
  ],
]);
