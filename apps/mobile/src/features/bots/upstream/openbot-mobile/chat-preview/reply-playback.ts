// Adapted from OpenBot iOS 1.4.11's reply-reveal and use-reply-playback.
// The Sled native Markdown view receives a text prefix rather than a token tree.
export function replyWordDelay(word: string): number {
  if (/[.!?…]["'”’)]*\s*$/u.test(word)) return 180;
  if (/[,;:]["'”’)]*\s*$/u.test(word)) return 100;
  return Math.min(80, 40 + word.trim().length * 3);
}

export function replyWordFeedback(word: string, index: number): "selection" | "soft" | "light" {
  if (/[.!?…]["'”’)]*\s*$/u.test(word)) return "light";
  return index % 4 === 0 || word.trim().length > 8 ? "soft" : "selection";
}

const FLUSH_AFTER_MS = 1_000;
const SHORT_TAIL_MS = 500;
const IDLE_INTERVAL_MS = 32;
const MAX_STREAM_TAIL_WORDS = 12;

function canFlush(words: readonly string[]) {
  let remaining = SHORT_TAIL_MS;
  for (const word of words) {
    remaining -= replyWordDelay(word);
    if (remaining < 0) return true;
  }
  return false;
}

export function startReplyPlayback({
  read,
  publish,
  complete,
}: {
  read: () => { body: string; streaming: boolean };
  publish: (prefix: string, word?: string, index?: number) => void;
  complete: () => void;
}) {
  let prefix = "";
  let index = 0;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const { body, streaming } = read();
    if (!body.startsWith(prefix)) {
      prefix = "";
      index = 0;
    }
    const words = Array.from(body.slice(prefix.length).matchAll(/\S+\s*/gu));
    if (
      !streaming &&
      (words.length === 0 ||
        (Date.now() - started >= FLUSH_AFTER_MS && canFlush(words.map(([word]) => word))))
    ) {
      publish(body);
      complete();
      return;
    }
    // Large chunks can catch up without adding a timer or a native node for every queued word.
    const count = streaming ? Math.max(1, words.length - MAX_STREAM_TAIL_WORDS) : 1;
    const word = words[count - 1];
    if (word === undefined) {
      timer = setTimeout(tick, IDLE_INTERVAL_MS);
      return;
    }
    prefix = body.slice(0, prefix.length + word.index + word[0].length);
    index += count;
    publish(prefix, word[0], index - 1);
    timer = setTimeout(tick, words.length > count ? replyWordDelay(word[0]) : 180);
  };
  timer = setTimeout(tick, IDLE_INTERVAL_MS);
  return () => clearTimeout(timer);
}
