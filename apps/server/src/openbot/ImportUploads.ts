// @effect-diagnostics nodeBuiltinImport:off -- bounded archive spool and durable receipt boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const MAX_BYTES = 104_857_600;
const LIFETIME = 24 * 60 * 60 * 1000;
interface Claims {
  readonly purpose: "openbot-agent-import";
  readonly uploadId: string;
  readonly principal: string;
  readonly hostId: string;
  readonly name: string;
  readonly size: number;
  readonly expiresAt: number;
}
const invalid = (): never => {
  throw new Error("Archive upload unavailable or invalid");
};
const digest = (bytes: Uint8Array) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

/** Private Files archive purpose. Tokens authorize only a bounded upload, never an import. */
export class ImportUploadStore {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly root: string;
  private readonly secret: string;
  constructor(root: string, secret: string) {
    this.root = root;
    this.secret = secret;
    if (!secret) invalid();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
  private signature(payload: string) {
    return NodeCrypto.createHmac("sha256", this.secret)
      .update("openbot-archive-upload-v1\n" + payload)
      .digest();
  }
  private encode(claims: Claims) {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${this.signature(payload).toString("base64url")}`;
  }
  private decode(token: string, now: number, allowExpired = false): Claims {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return invalid();
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return invalid();
    const actual = Buffer.from(signature, "base64url"),
      expected = this.signature(payload);
    if (actual.length !== expected.length || !NodeCrypto.timingSafeEqual(actual, expected))
      return invalid();
    const claims: Claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      claims.purpose !== "openbot-agent-import" ||
      !validId(claims.uploadId) ||
      typeof claims.principal !== "string" ||
      !claims.principal ||
      claims.principal.length > 256 ||
      typeof claims.hostId !== "string" ||
      !claims.hostId ||
      claims.hostId.length > 256 ||
      typeof claims.name !== "string" ||
      claims.name.length > 255 ||
      !/^[^/\\\u0000-\u001f]+\.zip$/i.test(claims.name) ||
      !Number.isSafeInteger(claims.size) ||
      claims.size < 1 ||
      claims.size > MAX_BYTES ||
      !Number.isSafeInteger(claims.expiresAt) ||
      !Number.isSafeInteger(now) ||
      (!allowExpired && claims.expiresAt <= now) ||
      claims.expiresAt > now + LIFETIME
    )
      return invalid();
    return claims;
  }
  private async writeExclusive(path: string, bytes: string) {
    const file = await NodeFSP.open(path, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
  }
  private async syncDirectory() {
    const directory = await NodeFSP.open(this.root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  private async optionalFile(path: string) {
    try {
      return await NodeFSP.readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }
  /** Called only after a transfer's durable complete/discarded receipt exists. */
  release(principal: string, hostId: string, uploadId: string, now: number) {
    return this.serial(async () => {
      if (!validId(uploadId)) return invalid();
      const releasedPath = NodePath.join(this.root, uploadId + ".released");
      const released = await this.optionalFile(releasedPath);
      const token =
        released ?? (await this.optionalFile(NodePath.join(this.root, uploadId + ".token")));
      if (!token) return invalid();
      const claims = this.decode(token, now, true);
      if (
        claims.uploadId !== uploadId ||
        claims.principal !== principal ||
        claims.hostId !== hostId
      )
        return invalid();
      if (!released) {
        const temporary = releasedPath + "." + NodeCrypto.randomUUID() + ".part";
        try {
          await this.writeExclusive(temporary, token);
          await NodeFSP.link(temporary, releasedPath);
          await this.syncDirectory();
        } finally {
          await NodeFSP.rm(temporary, { force: true });
        }
      }
      // Publish the fence before removing bytes; retrying cleanup never re-enables the signed URL.
      for (const suffix of [".zip", ".receipt", ".token"])
        await NodeFSP.rm(NodePath.join(this.root, uploadId + suffix), { force: true });
      await this.syncDirectory();
    });
  }
  issue(input: Omit<Claims, "purpose" | "uploadId" | "expiresAt">, now: number) {
    return this.serial(async () => {
      const claims: Claims = {
        ...input,
        purpose: "openbot-agent-import",
        uploadId: NodeCrypto.randomUUID(),
        expiresAt: now + LIFETIME,
      };
      const token = this.encode(claims);
      this.decode(token, now);
      await NodeFSP.mkdir(this.root, { recursive: true, mode: 0o700 });
      let retained = 0;
      const visited = new Set<string>();
      for (const name of await NodeFSP.readdir(this.root)) {
        if (!/^[0-9a-f-]{36}\.(?:token|released)$/.test(name)) continue;
        const uploadId = name.slice(0, name.lastIndexOf("."));
        if (visited.has(uploadId)) continue;
        visited.add(uploadId);
        const released = await this.optionalFile(NodePath.join(this.root, uploadId + ".released"));
        const previousToken =
          released ?? (await this.optionalFile(NodePath.join(this.root, uploadId + ".token")));
        if (!previousToken) continue;
        // Only signed, expired allocations in this private spool are eligible for cleanup.
        let previous: Claims;
        try {
          previous = this.decode(previousToken, now, true);
        } catch {
          continue;
        }
        if (uploadId !== previous.uploadId) continue;
        if (previous.expiresAt <= now) {
          for (const suffix of [".zip", ".receipt", ".token", ".released"])
            await NodeFSP.rm(NodePath.join(this.root, previous.uploadId + suffix), { force: true });
          continue;
        }
        if (released) {
          for (const suffix of [".zip", ".receipt", ".token"])
            await NodeFSP.rm(NodePath.join(this.root, previous.uploadId + suffix), { force: true });
          continue;
        }
        if (previous.principal === input.principal && previous.hostId === input.hostId) retained++;
      }
      if (retained >= 4)
        throw new Error("Discard or wait for existing archive uploads before uploading another");
      await this.writeExclusive(NodePath.join(this.root, claims.uploadId + ".token"), token);
      await this.syncDirectory();
      return { uploadId: claims.uploadId, token };
    });
  }
  owner(token: string, now: number) {
    return this.decode(token, now).principal;
  }
  store(token: string, chunks: AsyncIterable<Uint8Array>, now: number) {
    return this.serial(async () => {
      const claims = this.decode(token, now);
      if (await this.optionalFile(NodePath.join(this.root, claims.uploadId + ".released")))
        return invalid();
      if (
        (await NodeFSP.readFile(NodePath.join(this.root, claims.uploadId + ".token"), "utf8")) !==
        token
      )
        return invalid();
      const temporary = NodePath.join(
        this.root,
        `${claims.uploadId}.${NodeCrypto.randomUUID()}.part`,
      );
      const file = await NodeFSP.open(temporary, "wx", 0o600);
      const hash = NodeCrypto.createHash("sha256");
      let size = 0;
      try {
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          if (size > claims.size || size > MAX_BYTES) return invalid();
          hash.update(chunk);
          await file.writeFile(chunk);
        }
        if (size !== claims.size) return invalid();
        await file.sync();
        const sha256 = hash.digest("hex");
        const destination = NodePath.join(this.root, claims.uploadId + ".zip");
        try {
          await NodeFSP.link(temporary, destination);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
          if (
            (await NodeFSP.stat(destination)).size !== size ||
            digest(await NodeFSP.readFile(destination)) !== sha256
          )
            return invalid();
        }
        const receipt = JSON.stringify({ token, sha256 });
        const receiptPath = NodePath.join(this.root, claims.uploadId + ".receipt");
        // Exclusive publication; repeated bytes are safe, changed bytes never replace a receipt.
        const receiptTemp = temporary + ".receipt";
        try {
          await this.writeExclusive(receiptTemp, receipt);
          try {
            await NodeFSP.link(receiptTemp, receiptPath);
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
              throw error;
            if ((await NodeFSP.readFile(receiptPath, "utf8")) !== receipt) return invalid();
          }
          await this.syncDirectory();
        } finally {
          await NodeFSP.rm(receiptTemp, { force: true });
        }
        return { uploadId: claims.uploadId, size, sha256 };
      } finally {
        await file.close();
        await NodeFSP.rm(temporary, { force: true });
      }
    });
  }
  async read(principal: string, hostId: string, uploadId: string, now: number) {
    if (!validId(uploadId)) return invalid();
    if (await this.optionalFile(NodePath.join(this.root, uploadId + ".released"))) return invalid();
    const receipt: { token: string; sha256: string } = JSON.parse(
      await NodeFSP.readFile(NodePath.join(this.root, uploadId + ".receipt"), "utf8"),
    );
    const claims = this.decode(receipt.token, now);
    if (claims.uploadId !== uploadId || claims.principal !== principal || claims.hostId !== hostId)
      return invalid();
    const path = NodePath.join(this.root, uploadId + ".zip");
    if ((await NodeFSP.stat(path)).size !== claims.size) return invalid();
    const bytes = await NodeFSP.readFile(path);
    if (bytes.byteLength !== claims.size || digest(bytes) !== receipt.sha256) return invalid();
    return { bytes, name: claims.name, size: claims.size, sha256: receipt.sha256 };
  }
}
