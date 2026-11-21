import {
  EnvironmentId,
  ThreadId,
  type DeviceServiceState,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";

import { act, render } from "../../../test/render";

import { DevicePanel } from "./DevicePanel";
import { useDeviceWorkspaceStore } from "./deviceWorkspaceStore";
import "~/index.css";

type CommandResult =
  | { _tag: "Success"; value: { hostId: string; deviceId: string } }
  | { _tag: "Failure"; cause: unknown };
const mocks = vi.hoisted(() => ({
  open: vi.fn<(request: unknown) => Promise<CommandResult>>(),
  close: vi.fn<(request: unknown) => Promise<CommandResult>>(),
  list: vi.fn<(request: unknown) => Promise<CommandResult>>(),
  openDevice: vi.fn(),
  closeSurface: vi.fn(),
  setMaximized: vi.fn(),
}));
const phone = {
  hostId: "local",
  id: "phone",
  name: "Phone",
  platform: "ios",
  version: "iOS 19",
  booted: false,
  physical: false,
} as const;
const deviceState: DeviceServiceState = {
  hosts: [
    {
      id: "local",
      kind: "local",
      label: "This Mac",
      platforms: [{ platform: "ios", available: true }],
      hubInstalled: true,
      agentDeviceInstalled: true,
    },
  ],
  hostStatus: "ready",
  hostStatuses: { local: { status: "ready" } },
  devices: [phone],
  sessions: [
    {
      threadId: ThreadId.make("thread-1"),
      hostId: "local",
      deviceId: "phone",
      platform: "ios",
      openedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  onboardingCompleted: true,
  agentAccessEnabled: true,
  hubBasePath: "/api/device-hub",
  revision: 1,
};
let currentState = deviceState;
// One probe per environment, however many views mount it; each probe sends one list.
vi.mock("~/state/device", async () => {
  const Effect = await import("effect/Effect");
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    deviceEnvironment: { list: "list", open: "open", close: "close" },
    deviceHostProbeAtom: Atom.family((environmentId: string) =>
      Atom.make(() => Effect.promise(() => mocks.list({ environmentId, input: {} }))),
    ),
    NO_DEVICE_PROBE_ATOM: Atom.make(AsyncResult.initial<void, never>()),
    useDeviceState: () => ({ state: currentState, loaded: true }),
  };
});
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "open"
      ? mocks.open
      : command === "close"
        ? mocks.close
        : command === "list"
          ? mocks.list
          : () => Promise.resolve({ _tag: "Success", value: {} }),
}));
vi.mock("~/state/query", () => ({ formatEnvironmentQueryError: () => "Device failed" }));
vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({
      byThreadKey: {},
      openDevice: mocks.openDevice,
      closeSurface: mocks.closeSurface,
      setMaximized: mocks.setMaximized,
    }),
  },
  selectThreadRightPanelState: () => ({ isOpen: false, activeSurfaceId: null, surfaces: [] }),
}));
vi.mock("~/components/device/DeviceHostUpdates", () => ({ DeviceHostUpdates: () => null }));
vi.mock("~/components/device/DeviceWorkspace", () => ({
  DeviceWorkspace: ({ onPowerOff }: { onPowerOff: () => void }) => (
    <button onClick={onPowerOff}>Power off</button>
  ),
}));
vi.mock("~/components/preview/PreviewPanelShell", () => ({
  PreviewPanelShell: ({ children }: { children: ReactNode }) => (
    <div className="flex h-full min-h-0 flex-col">{children}</div>
  ),
}));

const threadA = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("thread-1"),
};
// The panel stays mounted across both kinds of switch.
const switches = [
  ["another thread", { environmentId: threadA.environmentId, threadId: ThreadId.make("thread-2") }],
  [
    "the same thread id in another environment",
    { ...threadA, environmentId: EnvironmentId.make("environment-b") },
  ],
] as const;
const threadB = switches[0][1];
const picker: Extract<RightPanelSurface, { kind: "device" }> = { id: "device", kind: "device" };
const phoneTarget = { hostId: "local", deviceId: "phone", platform: "ios", name: "Phone" };
const opened = { _tag: "Success", value: { hostId: "local", deviceId: "phone" } } as const;
const failed = { _tag: "Failure", cause: new Error("boom") } as const;

const deferred = () => {
  let settle!: (result: CommandResult) => void;
  const promise = new Promise<CommandResult>((resolve) => (settle = resolve));
  return { promise, settle };
};

let container: HTMLDivElement;
// Fixed key and a changing threadRef, as RightPanelSurfaceContent mounts it.
const devicePanel = (threadRef: ScopedThreadRef, surface = picker) => (
  <DevicePanel
    key="device-panel"
    mode="embedded"
    threadRef={threadRef}
    surface={surface}
    visible
    onDismissSetup={() => undefined}
  />
);
const startButton = () => container.querySelector<HTMLButtonElement>('[aria-label="Start Phone"]');
const click = (button: HTMLButtonElement | null) =>
  act(async () => {
    button!.click();
  });
const errors = () => container.querySelectorAll('[role="alert"]');

function setup() {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ _tag: "Success", value: { hostId: "local", deviceId: "" } });
  currentState = deviceState;
  useDeviceWorkspaceStore.setState({ byThreadKey: {} });
  container = document.createElement("div");
  container.style.width = "480px";
  container.style.height = "800px";
}

describe("DevicePanel thread switches", () => {
  it("keeps the latest pick pending across switches away and back", async () => {
    setup();
    const first = deferred();
    const second = deferred();
    const latest = deferred();
    mocks.open
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(latest.promise);
    await using screen = await render(devicePanel(threadA), { container });
    await click(startButton());
    await screen.rerender(devicePanel(threadB));
    await click(startButton());
    await screen.rerender(devicePanel(threadA));
    await click(startButton());

    await act(async () => first.settle(failed));

    expect(startButton()).toBeNull();
    expect(errors()).toHaveLength(0);
    expect(mocks.openDevice).not.toHaveBeenCalled();

    await act(async () => second.settle(opened));

    expect(startButton()).toBeNull();
    expect(mocks.openDevice.mock.calls).toEqual([[threadB, phoneTarget]]);

    await act(async () => latest.settle(opened));

    expect(startButton()?.disabled).toBe(false);
    expect(errors()).toHaveLength(0);
    expect(mocks.openDevice.mock.calls).toEqual([
      [threadB, phoneTarget],
      [threadA, phoneTarget],
    ]);
  });
});

describe("DevicePanel host probe", () => {
  it("probes the hosts once while setup shows inside the panel", async () => {
    setup();
    currentState = { ...deviceState, onboardingCompleted: false };
    // An environment no other test probed, so its probe starts fresh.
    const threadRef = { ...threadA, environmentId: EnvironmentId.make("environment-setup") };
    await using _screen = await render(devicePanel(threadRef), { container });

    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.list.mock.calls).toEqual([
      [{ environmentId: threadRef.environmentId, input: {} }],
    ]);
  });
});

describe("DevicePanel discovery warning", () => {
  it("a dismissal hides only the cause it was made for", async () => {
    setup();
    const withCause = (detail: string): DeviceServiceState => ({
      ...deviceState,
      hostStatuses: { local: { status: "ready", detail, incompletePlatforms: ["ios"] } },
    });
    const warning = "iOS list on This Mac may be incomplete.";
    currentState = withCause("first cause");
    await using screen = await render(devicePanel(threadA), { container });

    await screen.getByRole("button", { name: "Dismiss device warning for This Mac" }).click();
    await screen.rerender(devicePanel(threadA));
    await expect.element(screen.getByText(warning)).not.toBeInTheDocument();

    currentState = withCause("second cause");
    await screen.rerender(devicePanel(threadA));
    await expect.element(screen.getByText(warning)).toBeVisible();
  });
});

it("offers multi-view when a second device opens in this thread and waits for the user to enter", async () => {
  setup();
  const second = { ...phone, id: "second", name: "Second phone", booted: true };
  const elsewhere = {
    ...deviceState.sessions[0]!,
    threadId: threadB.threadId,
    deviceId: second.id,
  };
  currentState = {
    ...deviceState,
    devices: [phone, second],
    sessions: [...deviceState.sessions, elsewhere],
  };
  const surface: Extract<RightPanelSurface, { kind: "device" }> = {
    id: "device:local:phone",
    kind: "device",
    target: { ...phoneTarget, platform: "ios" },
  };
  await using screen = await render(devicePanel(threadA, surface), { container });
  await expect
    .element(screen.getByRole("button", { name: "View together" }))
    .not.toBeInTheDocument();
  currentState = {
    ...currentState,
    sessions: [...currentState.sessions, { ...deviceState.sessions[0]!, deviceId: second.id }],
  };
  await screen.rerender(devicePanel(threadA, surface));
  await expect.element(screen.getByRole("status")).toHaveTextContent("2 devices open");
  await expect.element(screen.getByRole("button", { name: "View together" })).toBeVisible();
  expect(container.querySelector("[data-device-workspace]")).toBeNull();
  await screen.getByRole("button", { name: "View together" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Phone preview", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Second phone preview", exact: true }))
    .toBeVisible();
  currentState = {
    ...currentState,
    sessions: currentState.sessions.filter(
      (session) => session.threadId !== threadA.threadId || session.deviceId === phone.id,
    ),
  };
  await screen.rerender(devicePanel(threadA, surface));
  await expect
    .element(screen.getByRole("button", { name: "View together" }))
    .not.toBeInTheDocument();
  expect(container.querySelector("[data-device-workspace]")).toBeNull();
  expect(mocks.openDevice).toHaveBeenLastCalledWith(threadA, phoneTarget);
  await screen.rerender(devicePanel(threadB));
  await expect
    .element(screen.getByRole("button", { name: "View together" }))
    .not.toBeInTheDocument();
});

it("keeps four streams mounted across grid and focus, selects input, and hides without powering off", async () => {
  setup();
  const second = { ...phone, id: "second", name: "Second phone", booted: true };
  const third = { ...phone, id: "third", name: "Third phone", booted: true };
  const fourth = { ...phone, id: "fourth", name: "Fourth phone", booted: true };
  currentState = {
    ...deviceState,
    devices: [{ ...phone, booted: true }, second, third, fourth],
    sessions: [
      ...deviceState.sessions,
      ...[second, third, fourth].map((device) => ({
        ...deviceState.sessions[0]!,
        deviceId: device.id,
      })),
    ],
  };
  useDeviceWorkspaceStore.getState().update(threadA, { selected: "local\u0000phone" });
  await using screen = await render(devicePanel(threadA), { container });
  await expect
    .element(screen.getByRole("region", { name: "Phone preview", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Second phone preview", exact: true }))
    .toBeVisible();
  const first = container.querySelector('[aria-label="Phone preview"]');
  const previews = [...container.querySelectorAll("section[aria-label$='preview']")];
  expect(previews).toHaveLength(4);
  await screen.getByRole("button", { name: "Focus", exact: true }).click();
  expect(container.querySelector('[aria-label="Phone preview"]')).toBe(first);
  expect([...container.querySelectorAll("section[aria-label$='preview']")]).toEqual(previews);
  await screen.getByRole("button", { name: "Control Second phone" }).click();
  expect(first?.querySelector("[inert]")).not.toBeNull();
  await screen.getByRole("button", { name: "Hide Phone preview" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Phone preview", exact: true }))
    .not.toBeInTheDocument();
  expect(mocks.close).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Show hidden" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Phone preview", exact: true }))
    .toBeVisible();
  await screen.rerender(devicePanel(threadB));
  expect(container.querySelector("[data-device-workspace]")).toBeNull();
  await screen.rerender(devicePanel(threadA));
  await expect
    .element(screen.getByRole("button", { name: "Focus", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  const fifth = { ...phone, id: "fifth", name: "Fifth phone", booted: true };
  currentState = {
    ...currentState,
    devices: [...currentState.devices, fifth],
    sessions: [...currentState.sessions, { ...deviceState.sessions[0]!, deviceId: fifth.id }],
  };
  await act(() =>
    useDeviceWorkspaceStore.getState().update(threadA, { selected: "local\u0000fifth" }),
  );
  await expect.element(screen.getByRole("region", { name: "Fifth phone preview" })).toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Phone preview", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Previous devices" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Phone preview", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Next devices" }).click();
  await screen.getByRole("button", { name: "Hide Fifth phone preview" }).click();
  expect(mocks.close).not.toHaveBeenCalled();
  await act(() =>
    useDeviceWorkspaceStore.getState().update(threadA, {
      picker: true,
      hidden: ["local\u0000phone"],
    }),
  );
  mocks.open.mockResolvedValueOnce(opened);
  await screen.getByRole("button", { name: "Open Phone", exact: true }).click();
  await expect
    .element(screen.getByRole("region", { name: "Phone preview", exact: true }))
    .toBeVisible();
  const workspace = Object.values(useDeviceWorkspaceStore.getState().byThreadKey)[0]!;
  expect(workspace.selected).toBe("local\u0000phone");
  expect(workspace.hidden).not.toContain("local\u0000phone");
  await act(() =>
    useDeviceWorkspaceStore.getState().update(threadA, {
      selected: null,
      hidden: currentState.devices.map((device) => `${device.hostId}\u0000${device.id}`),
    }),
  );
  await screen.getByRole("button", { name: "Show hidden previews", exact: true }).click();
  expect(Object.values(useDeviceWorkspaceStore.getState().byThreadKey)[0]!.selected).toBe(
    "local\u0000phone",
  );
});
