/* oxlint-disable shadcn/no-unknown-classes -- This test mounts the original transfer view. */
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../../../test/render";
import { InstanceTransferView, type InstanceTransferViewProps } from "./InstanceTransferView";
import "~/index.css";
import "../openbot-react.css";
const props = (): InstanceTransferViewProps => ({
  screen: "export",
  onScreenChange: vi.fn(),
  summary: {
    agents: [
      {
        id: "a",
        name: "Original bot",
        title: "",
        avatarSeed: "a",
        avatarHue: null,
        skillCount: 1,
        routineCount: 2,
        memoryCount: 3,
        fileCount: 1,
        fileBytes: 100,
      },
    ],
  },
  exportPhase: "options",
  exportFileName: null,
  exportWarnings: [],
  exportError: null,
  onExport: vi.fn(),
  onShowExport: vi.fn(),
  onExportAgain: vi.fn(),
  importPhase: "idle",
  preview: null,
  result: null,
  importError: null,
  onChoose: vi.fn(),
  onImport: vi.fn(),
  onCancelImport: vi.fn(),
  onImportDone: vi.fn(),
});
it("exports the exact selected bots and workspace/settings choices", async () => {
  const input = props();
  await using screen = await render(
    <div className="openbot-react">
      <InstanceTransferView {...input} />
    </div>,
  );
  await screen.getByRole("switch", { name: /Include workspace files/ }).click();
  await screen.getByRole("button", { name: "Save export file…", exact: true }).click();
  expect(input.onExport).toHaveBeenCalledExactlyOnceWith({
    agentIds: ["a"],
    includeFiles: false,
    includeSettings: true,
  });
});
it("supports importing only server settings and blocks an uncertain attempt from applying again", async () => {
  const input = {
    ...props(),
    screen: "import" as const,
    importPhase: "review" as const,
    preview: {
      token: "original",
      appVersion: "0.60.0",
      exportedAt: null,
      agents: [],
      hasSettings: true,
      warnings: [],
    },
  };
  await using screen = await render(
    <div className="openbot-react">
      <InstanceTransferView {...input} />
    </div>,
  );
  const submit = screen.getByRole("button", { name: "Import server settings", exact: true });
  await submit.click();
  expect(input.onImport).toHaveBeenCalledExactlyOnceWith([], true);
  await screen.rerender(
    <div className="openbot-react">
      <InstanceTransferView {...input} uncertain />
    </div>,
  );
  await expect.element(submit).toBeDisabled();
  expect(input.onImport).toHaveBeenCalledOnce();
});
