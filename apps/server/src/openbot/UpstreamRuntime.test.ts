// @effect-diagnostics nodeBuiltinImport:off -- Real loopback HTTP fixtures exercise bounded streaming downloads and isolated filesystem staging.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as UpstreamRuntime from "./UpstreamRuntime.ts";

const fixtureBytes = new TextEncoder().encode("isolated release artifact fixture\n");
const commit = "b".repeat(40);
const digest = NodeCrypto.createHash("sha256").update(fixtureBytes).digest("hex");
const repo = "https://github.com/nightly-labs/openbot";

const fixture = Effect.fn("test.upstreamFixture")(function* (
  options: {
    readonly bytes?: Uint8Array;
    readonly size?: number;
    readonly sha256?: string;
    readonly downloadUrl?: string;
    readonly version?: string;
    readonly directCommit?: boolean;
  } = {},
) {
  const version = options.version ?? "v0.61.0";
  const name = `OpenBot-${version.slice(1)}-arm64.zip`;
  const requests: string[] = [];
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeHttp.Server>((resolve, reject) => {
          const server = NodeHttp.createServer((request, response) => {
            response.setHeader("content-type", "application/json");
            const url = request.url ?? "";
            if (url.includes("/releases/download/")) {
              response.setHeader("content-type", "application/octet-stream");
              const bytes = options.bytes ?? fixtureBytes;
              response.write(bytes.slice(0, 3));
              response.end(bytes.slice(3));
            } else if (url.includes("/releases/")) {
              response.end(
                JSON.stringify({
                  tag_name: version,
                  draft: false,
                  prerelease: false,
                  html_url: `${repo}/releases/tag/${version}`,
                  published_at: "2026-11-04T00:00:00Z",
                  assets: [
                    {
                      name,
                      size: options.size ?? fixtureBytes.byteLength,
                      digest: `sha256:${options.sha256 ?? digest}`,
                      browser_download_url:
                        options.downloadUrl ?? `${repo}/releases/download/${version}/${name}`,
                    },
                  ],
                }),
              );
            } else if (url.includes("/git/ref/")) {
              response.end(
                JSON.stringify({
                  object: {
                    type: options.directCommit ? "commit" : "tag",
                    sha: options.directCommit ? commit : "a".repeat(40),
                  },
                }),
              );
            } else if (url.includes("/git/tags/")) {
              response.end(JSON.stringify({ object: { type: "commit", sha: commit } }));
            } else response.writeHead(404).end();
          });
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
  );
  const address = server.address();
  if (address === null || typeof address === "string") return yield* Effect.die("No fixture port");
  const http = yield* HttpClient.HttpClient;
  const transport = HttpClient.mapRequest(http, (request) => {
    requests.push(request.url);
    const url = new URL(request.url);
    return HttpClientRequest.setUrl(request, `http://127.0.0.1:${address.port}${url.pathname}`);
  });
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stateDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "sled-upstream-test-" });
  const layer = UpstreamRuntime.layer({ stateDirectory }).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, transport)),
  );
  return { stateDirectory, fs, path, layer, requests };
});

const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
  );

it.live(
  "checks annotated release tags, stages verified bytes, and persists audit across service restarts",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const staged = yield* Effect.gen(function* () {
        const service = yield* UpstreamRuntime.UpstreamRuntime;
        const release = yield* service.checkLatest;
        expect(release.releaseCommit).toBe(commit);
        expect(release.compatibility).toBe("requires-validation");
        expect(release.sourceLicenseUrl).toBe(`${repo}/blob/${commit}/LICENSE`);
        expect(release.sourceNoticeUrl).toBe(`${repo}/blob/${commit}/NOTICE`);
        return yield* service.stage({ version: release.version, platform: "darwin-arm64" });
      }).pipe(Effect.provide(f.layer));
      expect(Array.from(yield* f.fs.readFile(staged.artifactPath))).toEqual(
        Array.from(fixtureBytes),
      );
      expect(staged.sha256).toBe(digest);
      expect(staged.activation).toBe("blocked");
      expect(staged.artifactPath.startsWith(f.stateDirectory + f.path.sep)).toBe(true);
      const status = yield* Effect.gen(function* () {
        const service = yield* UpstreamRuntime.UpstreamRuntime;
        return yield* service.getStatus;
      }).pipe(Effect.provide(f.layer));
      expect(status.staged).toEqual([staged]);
      expect(status.audit.map((entry) => entry.operation)).toEqual(["checked", "staged"]);
      expect(status.activationAllowed).toBe(false);
      expect(status.productionMigrationAllowed).toBe(false);
      const names = yield* f.fs.readDirectory(f.path.join(f.stateDirectory, "openbot", "upstream"));
      expect(names.sort()).toEqual(["artifacts", "status.json"]);
      expect(f.requests).toContain(
        `https://api.github.com/repos/nightly-labs/openbot/git/tags/${"a".repeat(40)}`,
      );
      expect(
        f.requests.every(
          (url) =>
            url.startsWith("https://api.github.com/repos/nightly-labs/openbot/") ||
            url.startsWith(`${repo}/releases/download/`),
        ),
      ).toBe(true);
    }).pipe(provide),
);

it.live.each([
  { name: "checksum mismatch", options: { sha256: "f".repeat(64) } },
  { name: "truncated body", options: { size: fixtureBytes.byteLength + 1 } },
  { name: "oversized body", options: { size: fixtureBytes.byteLength - 1 } },
] as const)(
  "rejects $name, removes partial files, and records a failed staging decision",
  ({ options }) =>
    Effect.gen(function* () {
      const f = yield* fixture(options);
      yield* Effect.gen(function* () {
        const service = yield* UpstreamRuntime.UpstreamRuntime;
        const failure = yield* Effect.flip(
          service.stage({ version: "v0.61.0", platform: "darwin-arm64" }),
        );
        expect(failure.reason).toBe("integrity");
        const status = yield* service.getStatus;
        expect(status.staged).toEqual([]);
        expect(status.audit.at(-1)).toMatchObject({
          operation: "stage-failed",
          reason: "integrity",
        });
      }).pipe(Effect.provide(f.layer));
      const names = yield* f.fs.readDirectory(f.path.join(f.stateDirectory, "openbot", "upstream"));
      expect(names).toEqual(["status.json"]);
    }).pipe(provide),
);

it.live(
  "rejects nonofficial asset URLs and repointed baseline commits before any artifact download",
  () =>
    Effect.gen(function* () {
      for (const options of [
        { downloadUrl: "https://example.com/OpenBot.zip" },
        { version: "v0.60.0", directCommit: true },
      ]) {
        const f = yield* fixture(options);
        yield* Effect.gen(function* () {
          const service = yield* UpstreamRuntime.UpstreamRuntime;
          const failure = yield* Effect.flip(service.checkLatest);
          expect(failure.reason).toBe("integrity");
        }).pipe(Effect.provide(f.layer));
        expect(f.requests.some((url) => url.includes("/releases/download/"))).toBe(false);
      }
    }).pipe(provide),
);

it.live(
  "rejects path-like versions without network access and missing platform assets without downloading",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* UpstreamRuntime.UpstreamRuntime;
        expect((yield* Effect.flip(service.checkVersion("../../private"))).reason).toBe("metadata");
        expect(f.requests).toEqual([]);
        expect(
          (yield* Effect.flip(service.stage({ version: "v0.61.0", platform: "linux-x64" }))).reason,
        ).toBe("unsupported-platform");
        expect(f.requests.some((url) => url.includes("/releases/download/"))).toBe(false);
      }).pipe(Effect.provide(f.layer));
    }).pipe(provide),
);
