import { createContext } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../../../test/render";
import { InstanceTransferSettings } from "./InstanceTransferSettings";

const fixture = vi.hoisted(() => ({
  connection: {},
  download: vi.fn(),
  operations: [] as string[],
  pending: false,
}));
vi.mock("@effect/atom-react", () => ({
  RegistryContext: createContext({}),
  useAtomValue: () => true,
}));
vi.mock("../../../../state/session", () => ({
  readPreparedConnection: () => fixture.connection,
}));
vi.mock("../../../../state/openbot", () => ({
  openbot: { instanceTransfer: { permissionAtom: () => ({}) }, fileContext: "context" },
}));
vi.mock("../../../../state/assets", () => ({
  assetEnvironment: { createUrl: "asset" },
}));
vi.mock("../../../../state/use-atom-command", () => ({
  useAtomCommand:
    () =>
    async ({ input }: { input: { operation: string } }) => {
      fixture.operations.push(input.operation);
      return {
        _tag: "Success",
        value:
          input.operation === "summary"
            ? {
                agents: [
                  {
                    id: "a",
                    name: "Bot",
                    title: "",
                    avatarSeed: "a",
                    avatarHue: null,
                    skillCount: 0,
                    routineCount: 0,
                    memoryCount: 0,
                    fileCount: 0,
                    fileBytes: 0,
                  },
                ],
              }
            : input.operation === "pending"
              ? fixture.pending
                ? {
                    requestId: "original",
                    receipt: {
                      state: "staged",
                      preview: {
                        token: "original",
                        appVersion: "0.60.0",
                        exportedAt: null,
                        agents: [],
                        hasSettings: true,
                        warnings: [],
                      },
                      result: null,
                    },
                  }
                : null
              : {
                  file: {
                    attachmentId: "export",
                    name: "owned.zip",
                    mimeType: "application/zip",
                    size: 123,
                    sha256: "a".repeat(64),
                  },
                },
      };
    },
}));
vi.mock("../../../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (method: unknown) => async () => ({
    _tag: "Success",
    value: method === "context" ? { principalId: "owner" } : { relativeUrl: "/owned.zip" },
  }),
}));
vi.mock("../../../media/mediaContent", () => ({ downloadMedia: fixture.download }));
vi.mock("../../avatar/BotAvatar", () => ({ BotAvatar: () => null }));

it("downloads the host's materialized export without requiring an upload allocation", async () => {
  sessionStorage.clear();
  fixture.pending = false;
  fixture.operations = [];
  fixture.connection = { httpBaseUrl: "https://owned.example" };
  fixture.download.mockReset().mockResolvedValue(undefined);
  await using screen = await render(
    <InstanceTransferSettings
      environmentId={EnvironmentId.make("transfer-export")}
      hostId="host"
    />,
  );
  await screen.getByRole("button", { name: /Export from this server/ }).click();
  await screen.getByRole("button", { name: "Save export file…", exact: true }).click();
  await vi.waitFor(() =>
    expect(fixture.download).toHaveBeenCalledExactlyOnceWith(
      "https://owned.example/owned.zip",
      "owned.zip",
    ),
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("Export ready");
});

it("recovers the host's original staged review after tab storage is lost without restaging or applying", async () => {
  sessionStorage.clear();
  fixture.pending = true;
  fixture.operations = [];
  await using screen = await render(
    <InstanceTransferSettings
      environmentId={EnvironmentId.make("transfer-restart")}
      hostId="host"
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Import server settings", exact: true }))
    .toBeVisible();
  expect(fixture.operations).toEqual(["summary", "pending"]);
  expect(
    JSON.parse(
      sessionStorage.getItem(
        'sled:openbot:instance-transfer:["transfer-restart","host","owner"]',
      ) ?? "null",
    ),
  ).toEqual({ requestId: "original" });
});
