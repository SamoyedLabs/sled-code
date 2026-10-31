"use strict";
// This process belongs to Electron. The supervisor and its backend do not.
const fs = require("node:fs"),
  path = require("node:path"),
  net = require("node:net"),
  cp = require("node:child_process");
const { endpoint, secureDirectory, frames, send } = require("./protocol.cjs");
const bootstrap = JSON.parse(fs.readFileSync(3, "utf8"));
const home = bootstrap.t3Home;
if (typeof home !== "string" || !path.isAbsolute(home))
  throw new Error("Remote host requires an absolute T3 home");
const serverEntry = process.argv[2];
const location = endpoint(home);
secureDirectory(location.dir);
const pipes = new Map();
let channel,
  ending = false,
  spawned = false;
const parent = process.ppid;
let attempts = 0;
function connect() {
  if (ending) return;
  const s = net.createConnection(location.socket);
  s.once("error", (error) => {
    if (channel) return;
    if (!spawned && (error.code === "ENOENT" || error.code === "ECONNREFUSED")) {
      spawned = true;
      if (error.code === "ECONNREFUSED") {
        try {
          const st = fs.lstatSync(location.socket);
          if (st.isSocket() && st.uid === process.getuid()) fs.unlinkSync(location.socket);
        } catch {}
      }
      const child = cp.spawn(
        process.execPath,
        [path.join(__dirname, "daemon.cjs"), "--home", home],
        { env: process.env, detached: true, stdio: "ignore" },
      );
      child.unref();
    }
    if (++attempts > 80) {
      process.exitCode = 1;
      return;
    }
    setTimeout(connect, 100);
  });
  s.once("connect", () => {
    channel = s;
    send(s, {
      type: "attach",
      bootstrap,
      serverEntry,
      cwd: process.cwd(),
      guiInstance: process.env.T3_REMOTE_GUI_INSTANCE || String(parent),
    });
    frames(s, (m) => {
      if (m.type === "fd" && (m.fd === 5 || m.fd === 7)) {
        const bytes = Buffer.from(m.data, "base64");
        let output = pipes.get(m.fd);
        if (!output) {
          output = new net.Socket({
            fd: m.fd,
            readable: false,
            writable: true,
          });
          output.on("error", () => finish(1));
          pipes.set(m.fd, output);
        }
        if (output.writableLength > 8 * 1024 * 1024) {
          finish(1);
          return;
        }
        output.write(bytes);
      } else if (m.type === "backend-exit") {
        finish(1);
      }
    });
    s.on("close", () => finish(ending ? 0 : 1));
    for (const fd of [4, 6]) {
      const input = new net.Socket({ fd, readable: true, writable: false });
      pipes.set(fd, input);
      input.on("data", (data) => send(s, { type: "fd", fd, data: data.toString("base64") }));
      input.on("error", () => {});
    }
  });
}
function finish(code) {
  if (ending) return;
  ending = true;
  clearInterval(watch);
  if (channel) {
    send(channel, { type: "detach" });
    channel.end();
  }
  for (const pipe of pipes.values()) pipe.destroy();
  setTimeout(() => process.exit(code), 30);
}
process.on("SIGTERM", () => finish(0));
process.on("SIGINT", () => finish(0));
const watch = setInterval(() => {
  if (process.ppid !== parent) finish(0);
}, 500);
watch.unref();
connect();
