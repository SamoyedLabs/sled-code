/** Only process shutdown, never an operator cancellation, qualifies for restart recovery. */
export const APPROVAL_SHUTDOWN_REASON =
  "The server shut down before this runtime request was resolved.";
