import "~/index.css";
import { page } from "vite-plus/test/browser";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";
import { BotToolActivity } from "./BotToolActivity";

it("keeps actual tool commands hidden until the user inspects a span", async () => {
  const trace = {
    steps: [
      {
        id: "owned-tool",
        kind: "tool",
        command: "date -u",
        text: "Read UTC time",
        startedAt: "2026-11-14T01:00:00Z",
        endedAt: "2026-11-14T01:00:01Z",
      },
    ],
  };
  await using screen = await render(<BotToolActivity trace={trace} />);
  expect(screen.container.querySelector("pre")).toBeNull();
  await screen.getByRole("button", { name: "Open turn trace" }).click();
  await expect.element(page.getByText("Bot turn", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show step: date -u" }).click();
  await expect.element(screen.getByText('"command": "date -u"', { exact: false })).toBeVisible();
  await screen.getByRole("button", { name: "Collapse agent steps" }).click();
  expect(screen.container.querySelector("pre")).toBeNull();
});
it("does not present unsupported trace data as real work", async () => {
  await using screen = await render(
    <BotToolActivity trace={{ steps: [{ id: "bad", kind: "tool", command: 42 }] }} />,
  );
  expect(screen.container.textContent).toBe("");
});
it("inspects reported failures and usage in a folding/searchable trace and can replay without executing tools", async () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 15, 12, 0, seconds)).toISOString();
  await using screen = await render(
    <BotToolActivity
      trace={{
        startedAt: at(0),
        endedAt: at(60),
        tokens: 1234,
        costUsd: 0.012,
        steps: [
          { id: "think", kind: "reasoning", startedAt: at(10), endedAt: at(10) },
          {
            id: "failed",
            kind: "tool",
            text: "Read a private note",
            startedAt: at(10),
            endedAt: at(40),
            failed: true,
          },
          { id: "answer", kind: "message", startedAt: at(60), endedAt: at(60) },
        ],
      }}
    />,
  );
  await screen.getByRole("button", { name: "Open turn trace" }).click();
  const trace = page.getByRole("region", { name: "Turn trace" });
  await expect.element(trace.getByText("1,234", { exact: true })).toBeVisible();
  await trace.getByRole("button", { name: "Collapse Bot turn", exact: true }).click();
  await expect
    .element(trace.getByRole("button", { name: "Show step: Thinking", exact: true }))
    .not.toBeInTheDocument();
  await trace.getByRole("searchbox", { name: "Search trace" }).fill("private note");
  await expect
    .element(trace.getByRole("button", { name: "Show step: Read a private note", exact: true }))
    .toBeVisible();
  await expect
    .element(trace.getByRole("button", { name: "Show step: Bot turn", exact: true }))
    .toBeVisible();
  await trace.getByRole("searchbox", { name: "Search trace" }).fill("");
  await trace.getByRole("button", { name: "Expand Bot turn", exact: true }).click();
  await trace.getByRole("button", { name: "Errors", exact: true }).click();
  await expect
    .element(trace.getByRole("button", { name: "Show step: Thinking", exact: true }))
    .not.toBeInTheDocument();
  await trace.getByRole("button", { name: "Replay trace", exact: true }).click();
  await expect
    .element(trace.getByRole("button", { name: "Stop replay", exact: true }))
    .toBeVisible();
  await trace.getByRole("button", { name: "Stop replay", exact: true }).click();
  await trace.getByRole("button", { name: "Show step: Read a private note", exact: true }).click();
  await expect
    .element(
      screen.getByText("The provider reported this step as failed or declined.", { exact: true }),
    )
    .toBeVisible();
});
