import { StrictMode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { PreviewStreamingText } from "./PreviewStreamingText";

const preferences = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => preferences.reduced }));

it("reveals appended words and keeps settled DOM stable through idle rerenders", async () => {
  using _clock = fakeTimers();
  await using screen = await render(
    <StrictMode>
      <PreviewStreamingText text="Hello " streaming />
    </StrictMode>,
    {
      router: false,
    },
  );
  await act(() => vi.advanceTimersByTimeAsync(80));
  expect(screen.container.textContent).toBe("Hello ");
  expect(screen.container.querySelectorAll(".preview-stream-word").length).toBeGreaterThan(0);
  await screen.rerender(
    <StrictMode>
      <PreviewStreamingText text="Hello world. " streaming />
    </StrictMode>,
  );
  await act(() => vi.advanceTimersByTimeAsync(80));
  expect(screen.container.textContent).toBe("Hello world. ");
  await screen.rerender(
    <StrictMode>
      <PreviewStreamingText text="Hello world. " streaming={false} />
    </StrictMode>,
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));
  const settled = [...screen.container.querySelector("p")!.childNodes];
  await screen.rerender(
    <StrictMode>
      <PreviewStreamingText text="Hello world. " streaming={false} />
    </StrictMode>,
  );
  await act(() => vi.advanceTimersByTimeAsync(3000));
  const afterIdle = [...screen.container.querySelector("p")!.childNodes];
  expect(afterIdle).toHaveLength(settled.length);
  afterIdle.forEach((node, index) => expect(node).toBe(settled[index]));
  expect(screen.container.textContent).toBe("Hello world. ");
  expect(vi.getTimerCount()).toBe(0);
});

it("shows complete text immediately without animated spans when reduced motion is enabled", async () => {
  preferences.reduced = true;
  try {
    await using screen = await render(
      <PreviewStreamingText text="Complete sample reply" streaming />,
      { router: false },
    );
    expect(screen.container.textContent).toBe("Complete sample reply");
    expect(screen.container.querySelector(".preview-stream-word")).toBeNull();
  } finally {
    preferences.reduced = false;
  }
});

it("replaces typing dots with streamed words in the same bubble and clears them on stop", async () => {
  using _clock = fakeTimers();
  await using screen = await render(<PreviewStreamingText text="" streaming />, { router: false });
  const body = screen.container.querySelector("p");
  expect(body?.dataset.phase).toBe("typing");
  expect(body?.querySelectorAll(".bot-typing-dot")).toHaveLength(3);
  await screen.rerender(<PreviewStreamingText text="Hello " streaming />);
  await act(() => vi.advanceTimersByTimeAsync(80));
  expect(screen.container.querySelector("p")).toBe(body);
  expect(body?.textContent).toBe("Hello ");
  expect(body?.querySelector(".bot-typing")).toBeNull();
  await screen.rerender(<PreviewStreamingText text="Hello " streaming={false} />);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(body?.dataset.phase).toBe("complete");
  expect(vi.getTimerCount()).toBe(0);
});
it("removes an empty typing indicator when the reply is cancelled", async () => {
  await using screen = await render(<PreviewStreamingText text="" streaming />, { router: false });
  await screen.rerender(<PreviewStreamingText text="" streaming={false} />);
  expect(screen.container.querySelector(".bot-typing")).toBeNull();
});
