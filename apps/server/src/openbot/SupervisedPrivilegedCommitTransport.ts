// @effect-diagnostics nodeBuiltinImport:off -- private inherited process channel, never HTTP/WS.
import type * as NodeChildProcess from "node:child_process";
import * as NodeStream from "node:stream";
import type { DurablePrivilegedCommitAuthority } from "./DurablePrivilegedCommitAuthority.ts";
import type { PrivilegedCommitIdentity } from "./PrivilegedResponseCommitAuthority.ts";

import { handleQueueCommitFrame } from "./QueueCommitTransport.ts";

type Channel = ReturnType<DurablePrivilegedCommitAuthority["bindChild"]>;
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;

/** fd 4 must be a private extra 'pipe' created by spawn, not a socket path or a client credential. */
export function attachSupervisedPrivilegedCommitTransport(
  child: NodeChildProcess.ChildProcess,
  channel: Channel,
  activation?: {environmentId:string;hostId:string;allowed():boolean},
): { readonly negotiated: boolean } {
  const pipe = child.stdio[4];
  if (!(pipe instanceof NodeStream.Duplex)) throw new Error("Privileged commit unavailable");
  let buffer = "";
  let stopped = false;
  let negotiated = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    pipe.destroy();
    void channel.fence().catch(() => {});
  };
  pipe.setEncoding("utf8");
  pipe.on("error", stop);
  pipe.on("end", stop);
  pipe.on("close", stop);
  pipe.on("data", (chunk: string) => {
    if (stopped) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 8192) {
      stop();
      return;
    }
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const request = JSON.parse(line);
        if (request?.operation === "hello") {
          if (!id(request.id) || !exact(request, ["id", "operation"])) throw new Error();
          if (
            !pipe.write(
              JSON.stringify({ id: request.id, ok: true, incarnation: channel.incarnation }) + "\n",
            )
          )
            stop();
          negotiated = true;
          continue;
        }
        if (request?.operation === "activate") {
          if (!negotiated || !id(request.id) || !id(request.environmentId) || !id(request.hostId) || !exact(request,["id","operation","environmentId","hostId"])) throw new Error();
          const enabled = activation !== undefined && request.environmentId === activation.environmentId && request.hostId === activation.hostId && channel.activationReady() && activation.allowed();
          if (!pipe.write(JSON.stringify({id:request.id,ok:true,enabled,incarnation:channel.incarnation,environmentId:request.environmentId,hostId:request.hostId}) + "\n")) stop();
          continue;
        }
        const queueReply = handleQueueCommitFrame(request, channel);
        if (queueReply) {
          if (!pipe.write(JSON.stringify(queueReply) + "\n")) stop();
          continue;
        }
        if (
          !request ||
          typeof request !== "object" ||
          !id(request.id) ||
          !["acquire", "finish"].includes(request.operation) ||
          !exact(
            request,
            request.operation === "acquire"
              ? ["id", "operation", "principal", "nonce", "target"]
              : ["id", "operation", "principal", "nonce", "target", "permit"],
          ) ||
          !id(request.principal) ||
          !id(request.nonce) ||
          !request.target ||
          !exact(request.target, [
            "agentId",
            "threadId",
            "turnId",
            "messageId",
            "blockId",
            "requestId",
          ]) ||
          !["agentId", "threadId", "turnId", "messageId", "blockId"].every((k) =>
            id(request.target[k]),
          ) ||
          !(id(request.target.requestId) || Number.isSafeInteger(request.target.requestId)) ||
          (request.operation === "finish" && !id(request.permit))
        )
          throw new Error();
        const identity: Pick<PrivilegedCommitIdentity, "principal" | "nonce" | "target"> = request;
        let permit: string | undefined;
        try {
          if (request.operation === "acquire") permit = channel.acquire(identity);
          else channel.finish(request.permit, identity);
          if (
            !pipe.write(
              JSON.stringify({
                id: request.id,
                ok: true,
                ...(permit ? { permit, deadline: channel.deadline(permit) } : {}),
              }) + "\n",
            )
          )
            stop();
        } catch {
          if (!pipe.write(JSON.stringify({ id: request.id, ok: false }) + "\n")) stop();
        }
      } catch {
        stop();
        return;
      }
    }
  });
  return {
    get negotiated() {
      return negotiated && !stopped;
    },
  };
}
