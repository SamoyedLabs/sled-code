// @effect-diagnostics nodeBuiltinImport:off -- Node crypto hashes streamed release artifacts without buffering them in memory.
import * as NodeCrypto from "node:crypto";
import {
  OpenbotRuntimeVersion,
  OpenbotUpstreamStageInput,
  OpenbotUpstreamStatus,
  OpenbotUpstreamFailureReason,
  type OpenbotRuntimePlatform,
  type OpenbotUpstreamAsset,
  type OpenbotUpstreamRelease,
  type OpenbotStagedRuntime,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";

export class UpstreamRuntimeError extends Schema.TaggedError<UpstreamRuntimeError>()(
  "OpenbotUpstreamRuntimeError",
  { reason: OpenbotUpstreamFailureReason, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `Openbot runtime staging failed (${this.reason}).`;
  }
}

const BASELINE_VERSION = "v0.60.0";
const BASELINE_COMMIT = "0c7753fa622c38419939cd230657f40e5883d098";
const API = "https://api.github.com/repos/nightly-labs/openbot";
const REPOSITORY = "https://github.com/nightly-labs/openbot";
const MAX_JSON = 2_097_152;
const MAX_ARTIFACT = 1_073_741_824;
const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const GitObject = Schema.Struct({ type: Schema.Literals(["tag", "commit"]), sha: Commit });
const Ref = Schema.Struct({ object: GitObject });
const Release = Schema.Struct({
  tag_name: OpenbotRuntimeVersion,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  html_url: Schema.String,
  published_at: Schema.String,
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      size: Schema.Int,
      digest: Schema.NullOr(Schema.String),
      browser_download_url: Schema.String,
    }),
  ).check(Schema.isMaxLength(200)),
});
const decodeVersion = Schema.decodeUnknownEffect(OpenbotRuntimeVersion);
const decodeInput = Schema.decodeUnknownEffect(OpenbotUpstreamStageInput);
const decodeRelease = Schema.decodeUnknownEffect(Release);
const decodeRef = Schema.decodeUnknownEffect(Ref);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));
const decodeStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenbotUpstreamStatus));
const encodeStatus = Schema.encodeEffect(Schema.fromJsonString(OpenbotUpstreamStatus));
const decodePublicRelease = Schema.decodeUnknownEffect(
  // Validate timestamps and the projection before storing it or returning it to a transport.
  OpenbotUpstreamStatus.fields.available,
);
const isUpstreamRuntimeError = Schema.is(UpstreamRuntimeError);
const baselineHashes: Readonly<Record<OpenbotRuntimePlatform, string>> = {
  "darwin-arm64": "7537c3f3d7364bef996eb458837d203cd1835dbbf52a9355da815e219dbb31f7",
  "darwin-x64": "7cda3b7144d2fd8fe63fd86afbea9f32f89ddd875754d92c3a50189d931ff2fc",
  "linux-arm64": "62d9e397d577cd4f39975c89c6ed4635d52ce367a5276eef6095226111ea93c1",
  "linux-x64": "30d0861af7c7bbe84311bcf29a6291055cd3605bdd4bc07157db0f1bd1e0d26b",
  "win32-x64": "0d2bb5c513173321682de09854782844e5437da2ec16ed13b2a36ac4ec431e0f",
};
const suffixes: ReadonlyArray<readonly [OpenbotRuntimePlatform, string]> = [
  ["darwin-arm64", "arm64.zip"],
  ["darwin-x64", "x64.zip"],
  ["linux-arm64", "arm64.AppImage"],
  ["linux-x64", "x86_64.AppImage"],
  ["win32-x64", "x64.exe"],
];

export class UpstreamRuntime extends Context.Service<
  UpstreamRuntime,
  {
    readonly getStatus: Effect.Effect<OpenbotUpstreamStatus, UpstreamRuntimeError>;
    readonly checkLatest: Effect.Effect<OpenbotUpstreamRelease, UpstreamRuntimeError>;
    readonly checkVersion: (
      version: string,
    ) => Effect.Effect<OpenbotUpstreamRelease, UpstreamRuntimeError>;
    readonly stage: (
      input: OpenbotUpstreamStageInput,
    ) => Effect.Effect<OpenbotStagedRuntime, UpstreamRuntimeError>;
  }
>()("t3/openbot/UpstreamRuntime") {}

const make = Effect.fn("UpstreamRuntime.make")(function* (config: {
  readonly stateDirectory: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const gate = yield* Semaphore.make(1);
  if (
    !path.isAbsolute(config.stateDirectory) ||
    path.resolve(config.stateDirectory) === path.parse(config.stateDirectory).root
  ) {
    return yield* new UpstreamRuntimeError({ reason: "configuration" });
  }
  const root = path.join(config.stateDirectory, "openbot", "upstream");
  const statePath = path.join(root, "status.json");
  const initial: OpenbotUpstreamStatus = {
    baselineVersion: BASELINE_VERSION,
    baselineCommit: BASELINE_COMMIT,
    available: null,
    lastCheckedAt: null,
    staged: [],
    audit: [],
    activationAllowed: false,
    productionMigrationAllowed: false,
  };
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const readState = Effect.fn("UpstreamRuntime.readState")(function* () {
    const exists = yield* fs
      .exists(statePath)
      .pipe(Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })));
    if (!exists) return initial;
    const info = yield* fs
      .stat(statePath)
      .pipe(Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })));
    if (info.size > BigInt(MAX_JSON)) return yield* new UpstreamRuntimeError({ reason: "storage" });
    const text = yield* fs
      .readFileString(statePath)
      .pipe(Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })));
    return yield* decodeStatus(text).pipe(
      Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })),
    );
  });
  const saveState = Effect.fn("UpstreamRuntime.saveState")(
    function* (state: OpenbotUpstreamStatus) {
      yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });
      const temp = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: "state-" });
      const pending = path.join(temp, "status.json");
      const encoded = yield* encodeStatus(state);
      yield* fs.writeFileString(pending, encoded, { mode: 0o600 });
      yield* fs.rename(pending, statePath);
    },
    Effect.scoped,
    Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })),
  );

  const get = Effect.fn("UpstreamRuntime.get")(function* (url: string) {
    const response = yield* http
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
          HttpClientRequest.setHeader("x-github-api-version", "2022-11-28"),
          HttpClientRequest.setHeader("user-agent", "Sled-Openbot-Runtime"),
        ),
      )
      .pipe(
        Effect.timeout("30 seconds"),
        Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "transport", cause })),
      );
    if (response.status !== 200) return yield* new UpstreamRuntimeError({ reason: "transport" });
    return response;
  });
  const json = Effect.fn("UpstreamRuntime.json")(function* (url: string) {
    const response = yield* get(url);
    const decoder = new TextDecoder();
    const body = yield* response.stream.pipe(
      Stream.runFoldEffect(
        () => ({ bytes: 0, text: "" }),
        (state, chunk) =>
          state.bytes + chunk.byteLength > MAX_JSON
            ? Effect.fail(new UpstreamRuntimeError({ reason: "metadata" }))
            : Effect.succeed({
                bytes: state.bytes + chunk.byteLength,
                text: state.text + decoder.decode(chunk, { stream: true }),
              }),
      ),
      Effect.timeout("30 seconds"),
      Effect.mapError((cause) =>
        isUpstreamRuntimeError(cause)
          ? cause
          : new UpstreamRuntimeError({ reason: "transport", cause }),
      ),
    );
    return yield* decodeJson(body.text + decoder.decode()).pipe(
      Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "metadata", cause })),
    );
  });
  const resolveRelease = Effect.fn("UpstreamRuntime.resolveRelease")(function* (
    version: string | undefined,
  ) {
    if (version !== undefined)
      yield* decodeVersion(version).pipe(
        Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "metadata", cause })),
      );
    const release = yield* json(
      `${API}/releases/${version === undefined ? "latest" : `tags/${version}`}`,
    ).pipe(
      Effect.flatMap(decodeRelease),
      Effect.mapError((cause) =>
        isUpstreamRuntimeError(cause)
          ? cause
          : new UpstreamRuntimeError({ reason: "metadata", cause }),
      ),
    );
    if (
      release.draft ||
      release.prerelease ||
      (version !== undefined && release.tag_name !== version) ||
      release.html_url !== `${REPOSITORY}/releases/tag/${release.tag_name}`
    ) {
      return yield* new UpstreamRuntimeError({ reason: "metadata" });
    }
    const decodeObject = (value: Schema.Json) =>
      decodeRef(value).pipe(
        Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "metadata", cause })),
      );
    let object = (yield* json(`${API}/git/ref/tags/${release.tag_name}`).pipe(
      Effect.flatMap(decodeObject),
    )).object;
    for (let depth = 0; object.type === "tag" && depth < 8; depth++) {
      object = (yield* json(`${API}/git/tags/${object.sha}`).pipe(Effect.flatMap(decodeObject)))
        .object;
    }
    if (
      object.type !== "commit" ||
      (release.tag_name === BASELINE_VERSION && object.sha !== BASELINE_COMMIT)
    ) {
      return yield* new UpstreamRuntimeError({ reason: "integrity" });
    }
    const assets: OpenbotUpstreamAsset[] = [];
    for (const [platform, suffix] of suffixes) {
      const name = `OpenBot-${release.tag_name.slice(1)}-${suffix}`;
      const matches = release.assets.filter((asset) => asset.name === name);
      if (matches.length === 0) continue;
      const asset = matches[0]!;
      const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
      if (
        matches.length !== 1 ||
        digest === undefined ||
        asset.size < 1 ||
        asset.size > MAX_ARTIFACT ||
        asset.browser_download_url !==
          `${REPOSITORY}/releases/download/${release.tag_name}/${name}` ||
        (release.tag_name === BASELINE_VERSION && digest !== baselineHashes[platform])
      ) {
        return yield* new UpstreamRuntimeError({ reason: "integrity" });
      }
      assets.push({ platform, name, size: asset.size, sha256: digest });
    }
    const result: OpenbotUpstreamRelease = {
      version: release.tag_name,
      releaseCommit: object.sha,
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      assets,
      sourceLicenseUrl: `${REPOSITORY}/blob/${object.sha}/LICENSE`,
      sourceNoticeUrl: `${REPOSITORY}/blob/${object.sha}/NOTICE`,
      compatibility:
        release.tag_name === BASELINE_VERSION ? "pinned-baseline" : "requires-validation",
    };
    yield* decodePublicRelease(result).pipe(
      Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "metadata", cause })),
    );
    return result;
  });
  const checked = Effect.fn("UpstreamRuntime.check")(function* (version: string | undefined) {
    const release = yield* resolveRelease(version);
    const state = yield* readState();
    const at = yield* now;
    yield* saveState({
      ...state,
      available: release,
      lastCheckedAt: at,
      audit: [
        ...state.audit,
        { at, operation: "checked" as const, version: release.version },
      ].slice(-100),
    });
    return release;
  });
  const download = Effect.fn("UpstreamRuntime.download")(function* (
    response: HttpClientResponse.HttpClientResponse,
    asset: OpenbotUpstreamAsset,
    destination: string,
  ) {
    const hash = NodeCrypto.createHash("sha256");
    let size = 0;
    // Per-chunk hashing shares the download span and never buffers the whole artifact.
    yield* response.stream.pipe(
      Stream.mapEffect(
        Effect.fnUntraced(function* (chunk) {
          size += chunk.byteLength;
          if (size > asset.size) return yield* new UpstreamRuntimeError({ reason: "integrity" });
          hash.update(chunk);
          return chunk;
        }),
      ),
      Stream.run(fs.sink(destination, { mode: 0o600 })),
      Effect.timeout("15 minutes"),
      Effect.mapError((cause) =>
        isUpstreamRuntimeError(cause)
          ? cause
          : new UpstreamRuntimeError({ reason: "transport", cause }),
      ),
    );
    if (size !== asset.size || hash.digest("hex") !== asset.sha256)
      return yield* new UpstreamRuntimeError({ reason: "integrity" });
  });
  const stage = Effect.fn("UpstreamRuntime.stage")(function* (rawInput: OpenbotUpstreamStageInput) {
    const input = yield* decodeInput(rawInput).pipe(
      Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "metadata", cause })),
    );
    const run = Effect.gen(function* () {
      const release = yield* resolveRelease(input.version);
      const asset = release.assets.find((asset) => asset.platform === input.platform);
      if (asset === undefined)
        return yield* new UpstreamRuntimeError({ reason: "unsupported-platform" });
      yield* fs
        .makeDirectory(root, { recursive: true, mode: 0o700 })
        .pipe(Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })));
      const temp = yield* fs
        .makeTempDirectoryScoped({ directory: root, prefix: "download-" })
        .pipe(Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })));
      const pending = path.join(temp, asset.name);
      const response = yield* get(
        `${REPOSITORY}/releases/download/${release.version}/${asset.name}`,
      );
      yield* download(response, asset, pending);
      const directory = path.join(root, "artifacts", release.version, asset.sha256);
      const artifactPath = path.join(directory, asset.name);
      yield* fs
        .makeDirectory(directory, { recursive: true, mode: 0o700 })
        .pipe(Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })));
      yield* fs
        .rename(pending, artifactPath)
        .pipe(Effect.mapError((cause) => new UpstreamRuntimeError({ reason: "storage", cause })));
      const stagedAt = yield* now;
      const staged: OpenbotStagedRuntime = {
        ...asset,
        version: release.version,
        releaseCommit: release.releaseCommit,
        artifactPath,
        stagedAt,
        compatibility: release.compatibility,
        activation: "blocked",
      };
      const state = yield* readState();
      yield* saveState({
        ...state,
        available: release,
        lastCheckedAt: stagedAt,
        staged: [
          ...state.staged.filter(
            (entry) => !(entry.version === staged.version && entry.platform === staged.platform),
          ),
          staged,
        ].slice(-100),
        audit: [
          ...state.audit,
          {
            at: stagedAt,
            operation: "staged" as const,
            version: staged.version,
            platform: staged.platform,
          },
        ].slice(-100),
      });
      return staged;
    }).pipe(Effect.scoped);
    return yield* run.pipe(
      Effect.catchTags({
        OpenbotUpstreamRuntimeError: Effect.fn("UpstreamRuntime.recordStageFailure")(
          function* (failure) {
            const state = yield* readState();
            const at = yield* now;
            yield* saveState({
              ...state,
              audit: [
                ...state.audit,
                {
                  at,
                  operation: "stage-failed" as const,
                  version: input.version,
                  platform: input.platform,
                  reason: failure.reason,
                },
              ].slice(-100),
            });
            return yield* failure;
          },
        ),
      }),
    );
  }, gate.withPermits(1));
  return UpstreamRuntime.of({
    // Atomic manifests let clients read the last completed status during a long download.
    getStatus: readState(),
    checkLatest: checked(undefined).pipe(gate.withPermits(1)),
    checkVersion: Effect.fn("UpstreamRuntime.checkVersion")((version: string) =>
      checked(version).pipe(gate.withPermits(1)),
    ),
    stage,
  });
});

// This service owns staged archives only. There is deliberately no activation or migration method.
export const layer = (config: { readonly stateDirectory: string }) =>
  Layer.effect(UpstreamRuntime, make(config));
