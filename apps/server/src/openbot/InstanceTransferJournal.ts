// @effect-diagnostics nodeBuiltinImport:off -- Private restart-safe transfer receipts.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import {
  OpenbotTransferPreview,
  OpenbotTransferResult,
  type OpenbotTransferReceipt,
} from "@t3tools/contracts/openbot-instance-transfer";
const decodePreview = Schema.decodeUnknownSync(OpenbotTransferPreview),
  decodeResult = Schema.decodeUnknownSync(OpenbotTransferResult);
type Row = {
  principal: string;
  hostId: string;
  requestId: string;
  fingerprint: string;
  state: "staging" | OpenbotTransferReceipt["state"];
  preview: OpenbotTransferPreview | null;
  result: OpenbotTransferResult | null;
  applyFingerprint?: string;
  uploadId?: string;
};
type RecoverOwner = (owner: string) => Promise<boolean>;
const fingerprint = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class InstanceTransferJournal {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  private path(principal: string, hostId: string, requestId: string) {
    return NodePath.join(this.root, fingerprint([principal, hostId, requestId]) + ".json");
  }
  private serial<A>(run: () => Promise<A>): Promise<A> {
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }
  private async save(row: Row) {
    await NodeFSP.mkdir(this.root, { recursive: true, mode: 0o700 });
    const destination = this.path(row.principal, row.hostId, row.requestId),
      temporary = destination + "." + NodeCrypto.randomUUID() + ".part";
    const file = await NodeFSP.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(row));
      await file.sync();
    } finally {
      await file.close();
    }
    await NodeFSP.rename(temporary, destination);
    const directory = await NodeFSP.open(this.root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  private async load(principal: string, hostId: string, requestId: string): Promise<Row | null> {
    try {
      const row: Row = JSON.parse(
        await NodeFSP.readFile(this.path(principal, hostId, requestId), "utf8"),
      );
      if (row.principal !== principal || row.hostId !== hostId || row.requestId !== requestId)
        throw Error("Transfer ownership changed.");
      return row;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }
  private async activeOwner(hostId: string) {
    try {
      const active: { principal: string; requestId: string } = JSON.parse(
        await NodeFSP.readFile(
          NodePath.join(this.root, "active-" + fingerprint(hostId) + ".json"),
          "utf8",
        ),
      );
      return active;
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
      throw cause;
    }
  }
  private async loadOwned(
    principal: string,
    hostId: string,
    requestId: string,
    recoverOwner?: RecoverOwner,
  ) {
    const owned = await this.load(principal, hostId, requestId);
    if (owned || !recoverOwner) return owned;
    const active = await this.activeOwner(hostId);
    return active?.requestId === requestId && (await recoverOwner(active.principal))
      ? this.load(active.principal, hostId, requestId)
      : null;
  }
  private receipt(row: Row): OpenbotTransferReceipt {
    return {
      state: row.state === "staging" || row.state === "applying" ? "uncertain" : row.state,
      preview: row.preview ? { ...row.preview, token: row.requestId } : null,
      result: row.result,
    };
  }
  recover(principal: string, hostId: string, requestId: string, recoverOwner?: RecoverOwner) {
    return this.serial(async () => {
      const row = await this.loadOwned(principal, hostId, requestId, recoverOwner);
      return row ? this.receipt(row) : null;
    });
  }
  pending(principal: string, hostId: string, recoverOwner?: RecoverOwner) {
    return this.serial(async () => {
      const active = await this.activeOwner(hostId);
      if (!active || (active.principal !== principal && !(await recoverOwner?.(active.principal))))
        return null;
      const row = await this.load(active.principal, hostId, active.requestId);
      return row && !["complete", "discarded"].includes(row.state)
        ? { requestId: row.requestId, receipt: this.receipt(row) }
        : null;
    });
  }
  /** Replay remains available after finalized archive bytes have been released. */
  stageReceipt(
    principal: string,
    hostId: string,
    requestId: string,
    uploadId: string,
    recoverOwner?: RecoverOwner,
  ) {
    return this.serial(async () => {
      const row = await this.loadOwned(principal, hostId, requestId, recoverOwner);
      if (!row?.uploadId) return null; // Old receipts still use the byte-fingerprint path.
      if (row.uploadId !== uploadId) throw Error("The original transfer archive changed.");
      return this.receipt(row);
    });
  }
  finalizedUpload(
    principal: string,
    hostId: string,
    requestId: string,
    recoverOwner?: RecoverOwner,
  ) {
    return this.serial(async () => {
      const row = await this.loadOwned(principal, hostId, requestId, recoverOwner);
      return row?.uploadId && ["complete", "discarded"].includes(row.state)
        ? { uploadId: row.uploadId, principal: row.principal }
        : null;
    });
  }
  stage(
    principal: string,
    hostId: string,
    requestId: string,
    uploadFingerprint: string,
    run: () => Promise<unknown>,
    uploadId?: string,
  ) {
    return this.serial(async () => {
      const old = await this.load(principal, hostId, requestId);
      if (old) {
        if (old.fingerprint !== uploadFingerprint || (old.uploadId && old.uploadId !== uploadId))
          throw Error("The original transfer archive changed.");
        return this.receipt(old);
      }
      const activePath = NodePath.join(this.root, "active-" + fingerprint(hostId) + ".json");
      try {
        const active: { principal: string; requestId: string } = JSON.parse(
          await NodeFSP.readFile(activePath, "utf8"),
        );
        const activeRow = await this.load(active.principal, hostId, active.requestId);
        if (activeRow && !["complete", "discarded"].includes(activeRow.state))
          throw Error("Finish the existing server transfer before opening another archive.");
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
      }
      const row: Row = {
        principal,
        hostId,
        requestId,
        fingerprint: uploadFingerprint,
        state: "staging",
        preview: null,
        result: null,
        ...(uploadId ? { uploadId } : {}),
      };
      await this.save(row);
      const active = await NodeFSP.open(activePath, "w", 0o600);
      try {
        await active.writeFile(JSON.stringify({ principal, requestId }));
        await active.sync();
      } finally {
        await active.close();
      }
      row.preview = decodePreview(await run());
      row.state = "staged";
      await this.save(row);
      return this.receipt(row);
    });
  }
  apply(
    principal: string,
    hostId: string,
    requestId: string,
    selection: { keys: readonly string[]; includeSettings: boolean; timezone: string },
    run: (upstreamToken: string) => Promise<unknown>,
    recoverOwner?: RecoverOwner,
  ) {
    return this.serial(async () => {
      const row = await this.loadOwned(principal, hostId, requestId, recoverOwner);
      if (!row?.preview) throw Error("Recover the original transfer before importing.");
      const selected = fingerprint({ ...selection, keys: [...selection.keys].sort() });
      if (row.applyFingerprint && row.applyFingerprint !== selected)
        throw Error("The original import selection changed.");
      if (row.state !== "staged") return this.receipt(row);
      if (
        (!selection.keys.length && !selection.includeSettings) ||
        (selection.includeSettings && !row.preview.hasSettings) ||
        new Set(selection.keys).size !== selection.keys.length ||
        selection.keys.some((key) => !row.preview!.agents.some((agent) => agent.key === key))
      )
        throw Error("Choose agents or settings from this transfer.");
      row.applyFingerprint = selected;
      row.state = "applying";
      await this.save(row);
      row.result = decodeResult(await run(row.preview.token));
      row.state = "complete";
      await this.save(row);
      return this.receipt(row);
    });
  }
  discard(
    principal: string,
    hostId: string,
    requestId: string,
    run: (upstreamToken: string) => Promise<unknown>,
    recoverOwner?: RecoverOwner,
  ) {
    return this.serial(async () => {
      const row = await this.loadOwned(principal, hostId, requestId, recoverOwner);
      if (!row) throw Error("Original transfer unavailable.");
      if (row.state === "applying" || row.state === "staging" || row.state === "uncertain")
        throw Error("The transfer outcome is uncertain; do not replay or discard it.");
      if (row.state === "discarded") return this.receipt(row);
      if (row.state === "staged" && row.preview) await run(row.preview.token);
      row.state = "discarded";
      await this.save(row);
      return this.receipt(row);
    });
  }
}
