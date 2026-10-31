"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  net = require("node:net");
const defaults = {
  enabled: false,
  lifecycle: "with-t3",
  clipboard: true,
  "virtual-display": true,
  audio: true,
  "direct-wireless": false,
  remote: true,
  internet: true,
};
const featureKeys = [
  "clipboard",
  "virtual-display",
  "audio",
  "direct-wireless",
  "remote",
  "internet",
];
function normalize(value) {
  const result = { ...defaults };
  if (value && typeof value === "object") {
    for (const key of ["enabled", ...featureKeys])
      if (typeof value[key] === "boolean") result[key] = value[key];
    if (value.lifecycle === "persistent") result.lifecycle = "persistent";
  }
  return result;
}
function endpoint(home) {
  const hash = crypto.createHash("sha256").update(path.resolve(home)).digest("hex").slice(0, 20);
  const dir = path.join(os.tmpdir(), "t3rd-" + process.getuid() + "-" + hash);
  return { dir, socket: path.join(dir, "host.sock") };
}
function secureDirectory(dir) {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const st = fs.lstatSync(dir);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    (st.mode & 0o077) !== 0
  )
    throw new Error("Unsafe remote host IPC directory");
}
const MAX_FRAME = 8 * 1024 * 1024;
function frames(socket, onMessage) {
  let pending = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    pending += chunk;
    if (Buffer.byteLength(pending) > MAX_FRAME) {
      socket.destroy();
      return;
    }
    for (;;) {
      const n = pending.indexOf("\n");
      if (n < 0) break;
      const line = pending.slice(0, n);
      pending = pending.slice(n + 1);
      try {
        onMessage(JSON.parse(line));
      } catch {
        socket.destroy();
        return;
      }
    }
  });
}
function send(socket, message) {
  if (!socket.destroyed) {
    if (socket.writableLength > MAX_FRAME) {
      socket.destroy();
      return false;
    }
    return socket.write(JSON.stringify(message) + "\n");
  }
  return false;
}
function rpc(home, request, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint(home).socket);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Remote host unavailable"));
    }, timeout);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.on("connect", () => send(socket, request));
    socket.on("error", (e) => finish(e));
    socket.on("close", () => finish(new Error("Remote host disconnected")));
    frames(socket, (m) => {
      if (m.type === "result") finish(m.error ? new Error(m.error) : null, m.value);
    });
  });
}
module.exports = {
  defaults,
  featureKeys,
  normalize,
  endpoint,
  secureDirectory,
  frames,
  send,
  rpc,
  MAX_FRAME,
};
