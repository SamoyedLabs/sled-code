import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { useSettingsScope } from "./SettingsScopeContext";
import { Route } from "../../routes/_chat.settings";
import type { SettingsScopeSearch } from "./settingsScope";

const environmentId = EnvironmentId.make("scope-owner");
vi.mock("../../state/environments", async (original) => ({
  ...(await original<typeof import("../../state/environments")>()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("scope-owner"),
  useEnvironments: () => ({
    environments: [
      {
        environmentId: EnvironmentId.make("scope-owner"),
        label: "Owned host",
        connection: { phase: "connected" },
        serverConfig: {
          settings: DEFAULT_SERVER_SETTINGS,
          environment: { platform: { machine: "desktop" } },
        },
      },
    ],
  }),
}));
vi.mock("./useSettingsProjectGroups", () => ({ useSettingsProjectGroups: () => [] }));
vi.mock("../AppRouteModal", () => ({
  AppRouteModal: ({ children }: { children: ReactNode }) => children,
  AppRouteModalClose: () => null,
}));
vi.mock("./SettingsSidebarNav", () => ({ SettingsSidebarNav: () => null }));
vi.mock("./SettingsBreadcrumb", () => ({ SettingsBreadcrumb: () => null }));
vi.mock("./SettingsScopeNotice", () => ({
  SettingsScopeNotice: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Outlet: () => {
    const { scope } = useSettingsScope();
    return <p>Host panel: {scope.kind === "environment" ? scope.environmentId : scope.kind}</p>;
  },
}));

it("selects one host for a bot deep link without broadening a stale host", async () => {
  let search: SettingsScopeSearch = {};
  using _search = vi.spyOn(Route, "useSearch").mockImplementation(() => search);
  using _navigate = vi.spyOn(Route, "useNavigate").mockImplementation(() => async () => {});
  const Layout = Route.options.component!;
  await using screen = await render(<Layout />, {
    router: "/settings/bots#bot-host-browser-profiles",
  });
  await expect
    .element(screen.getByText(`Host panel: ${environmentId}`, { exact: true }))
    .toBeVisible();
  search = { machine: "removed-environment" };
  await screen.rerender(<Layout />);
  await expect
    .element(screen.getByText("This environment is no longer available.", { exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByText(`Host panel: ${environmentId}`, { exact: true }))
    .not.toBeInTheDocument();
});
