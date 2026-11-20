// @effect-diagnostics nodeBuiltinImport:off -- Persist the original task start before dispatch, so an uncertain start cannot launch twice.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { OpenbotNewTaskStartInput } from "@t3tools/contracts/openbot-instance-transfer";
const Created = Schema.Struct({ id: Schema.String, agentId: Schema.String });
const Row = Schema.Struct({ fingerprint: Schema.String, result: Schema.NullOr(Created) });
const decode = Schema.decodeUnknownSync(Row),
  decodeCreated = Schema.decodeUnknownSync(Created);
export class NewTaskStartJournal {
  private readonly root: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(root: string) {
    this.root = root;
  }
  run(
    principal: string,
    input: typeof OpenbotNewTaskStartInput.Type,
    start: () => Promise<unknown>,
  ) {
    const run = async () => {
      const key = NodeCrypto.createHash("sha256")
        .update(JSON.stringify([principal, input.hostId, input.agentId, input.clientMessageId]))
        .digest("hex");
      const fingerprint = NodeCrypto.createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const destination = NodePath.join(this.root, key + ".json");
      try {
        const old = decode(JSON.parse(await NodeFSP.readFile(destination, "utf8")));
        if (old.fingerprint !== fingerprint) throw Error("The original task start changed.");
        if (!old.result)
          throw Error(
            "The original task start is uncertain. Check the task list; it will not be started again.",
          );
        return old.result;
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
      }
      await NodeFSP.mkdir(this.root, { recursive: true, mode: 0o700 });
      const save = async (result: typeof Created.Type | null) => {
        const temporary = destination + "." + NodeCrypto.randomUUID() + ".part",
          file = await NodeFSP.open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify({ fingerprint, result }));
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
      };
      await save(null);
      const result = decodeCreated(await start());
      if (result.agentId !== input.agentId) throw Error("The task start returned a different bot.");
      await save(result);
      return result;
    };
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
