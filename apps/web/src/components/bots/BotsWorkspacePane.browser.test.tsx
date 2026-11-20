import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { BotsWorkspacePane } from "./BotsWorkspacePane";

const source = vi.hoisted(() => ({
  subscribe: vi.fn((_listener: () => void): (() => void) => () => {}),
  read: vi.fn(() => 0),
}));
vi.mock("./ReactBotWorkspace", async () => {
  const { useState, useSyncExternalStore } = await import("react");
  return {
    ReactBotWorkspace: function Fixture() {
      const revision = useSyncExternalStore(source.subscribe, source.read);
      const [draft, setDraft] = useState("");
      return (
        <div>
          <p>Revision {revision}</p>
          <textarea
            aria-label="Retained bot draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div aria-label="Retained chat scroll" style={{ height: 80, overflow: "auto" }}>
            <div style={{ height: 800 }}>History</div>
          </div>
        </div>
      );
    },
  };
});

it("suspends hidden external readers and preserves the draft and scroll node across Code round trips", async () => {
  const listeners = new Set<() => void>();
  let revision = 0;
  source.subscribe.mockReset().mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  source.read.mockReset().mockImplementation(() => revision);
  await using screen = await render(<BotsWorkspacePane active />);
  await screen.getByRole("textbox", { name: "Retained bot draft" }).fill("keep this draft");
  const scroll = screen.getByLabelText("Retained chat scroll").element();
  scroll.scrollTop = 260;
  expect(listeners.size).toBe(1);
  await screen.rerender(<BotsWorkspacePane active={false} />);
  expect(listeners.size).toBe(0);
  const hiddenReads = source.read.mock.calls.length;
  await act(() => {
    revision = 20;
    for (const listener of listeners) listener();
  });
  expect(source.read.mock.calls.length).toBe(hiddenReads);
  await screen.rerender(<BotsWorkspacePane active />);
  await expect.element(screen.getByText("Revision 20")).toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "Retained bot draft" }))
    .toHaveValue("keep this draft");
  expect(screen.getByLabelText("Retained chat scroll").element()).toBe(scroll);
  expect(scroll.scrollTop).toBe(260);
  expect(listeners.size).toBe(1);
});
