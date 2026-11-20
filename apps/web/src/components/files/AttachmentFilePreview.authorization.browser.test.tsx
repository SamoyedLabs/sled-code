import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render, stubGlobal } from "../../../test/render";
import { AttachmentFilePreview } from "./AttachmentFilePreview";
const fixture = vi.hoisted(() => ({ mint: vi.fn() }));
vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlRefresh: (environment: unknown, resource: unknown) => () =>
    fixture.mint(environment, resource),
  useAssetUrlState: () => ({ url: null, error: null }),
  resolveAssetUrl: (_base: string, relative: string) => relative,
}));
vi.mock("./ReadOnlySourcePreview", () => ({ default: () => null }));

it("loads a remote attachment once across rerenders and reauthorizes a different environment/file", async () => {
  fixture.mint
    .mockReset()
    .mockImplementation(async (_env, resource) => `https://owned.example/${resource.attachmentId}`);
  using _fetch = stubGlobal(
    "fetch",
    vi.fn(
      async (url) =>
        new Response(
          String(url).endsWith("first") ? "FIRST_AUTHORIZED_BODY" : "SECOND_AUTHORIZED_BODY",
        ),
    ),
  );
  const view = (environment: string, attachmentId: string) => (
    <AttachmentFilePreview
      name="owned.txt"
      mimeType="text/plain"
      sizeBytes={30}
      asset={{ environmentId: EnvironmentId.make(environment), attachmentId }}
      renderTextPreview={({ text }) => <pre>{text}</pre>}
    />
  );
  await using screen = await render(view("original", "first"));
  await expect.element(screen.getByText("FIRST_AUTHORIZED_BODY", { exact: true })).toBeVisible();
  expect(fixture.mint).toHaveBeenCalledOnce();
  await screen.rerender(view("original", "first"));
  await expect.element(screen.getByText("FIRST_AUTHORIZED_BODY", { exact: true })).toBeVisible();
  expect(fixture.mint).toHaveBeenCalledOnce();
  await screen.rerender(view("successor", "second"));
  await expect.element(screen.getByText("SECOND_AUTHORIZED_BODY", { exact: true })).toBeVisible();
  expect(fixture.mint).toHaveBeenCalledTimes(2);
  expect(fixture.mint).toHaveBeenLastCalledWith(
    "successor",
    expect.objectContaining({ attachmentId: "second" }),
  );
});
