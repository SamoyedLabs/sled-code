import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { BotBrowserView } from "./BotBrowserView";

it("keeps held modifiers through ordinary capture release and releases them on unexpected capture loss", async () => {
  const send = vi.fn<(message: string) => void>();
  const peer = Object.assign(new EventTarget(), {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    binaryType: "arraybuffer",
    send,
    close: vi.fn(),
  });
  const connect = async () => peer as unknown as WebSocket;
  // This viewer has no links or navigation.
  await using screen = await render(<BotBrowserView connect={connect} interactive />, {
    router: false,
  });
  await expect.element(screen.getByRole("status")).toHaveTextContent("Browser view connected");
  const surface = screen.container.querySelector("img");
  if (!surface) throw new Error("Missing browser surface");
  let captured: number | null = null;
  surface.setPointerCapture = (id) => {
    captured = id;
  };
  surface.hasPointerCapture = (id) => captured === id;
  surface.releasePointerCapture = (id) => {
    if (captured !== id) return;
    captured = null;
    surface.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: id, bubbles: true }));
  };
  surface.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
  const pointer = (type: string, id: number) =>
    surface.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
        shiftKey: true,
      }),
    );
  const key = (type: string) =>
    surface.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        key: "Shift",
        code: "ShiftLeft",
        shiftKey: type === "keydown",
      }),
    );
  await act(() => {
    surface.focus();
    send.mockClear();
    key("keydown");
    pointer("pointerdown", 1);
    pointer("pointerup", 1);
  });
  expect(captured).toBeNull();
  expect(send.mock.calls.map(([message]) => JSON.parse(message))).toEqual([
    expect.objectContaining({ type: "key", action: "down", key: "Shift" }),
    expect.objectContaining({ type: "pointer", action: "down" }),
    expect.objectContaining({ type: "pointer", action: "up" }),
  ]);
  await act(() => key("keyup"));
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toMatchObject({
    type: "key",
    action: "up",
    key: "Shift",
  });
  await act(() => {
    key("keydown");
    pointer("pointerdown", 2);
    surface.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 99, bubbles: true }));
  });
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toMatchObject({ type: "pointer", action: "down" });
  await act(() => surface.releasePointerCapture(2));
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toEqual({ type: "release" });
  const attempts = send.mock.calls.length;
  await act(() => key("keyup"));
  expect(send.mock.calls).toHaveLength(attempts);
  await act(() => {
    key("keydown");
    pointer("pointerdown", 3);
  });
  expect(captured).toBe(3);
  await screen.rerender(<BotBrowserView connect={connect} interactive={false} />);
  expect(captured).toBeNull();
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toEqual({ type: "release" });
});
