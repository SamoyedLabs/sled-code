const path = require("node:path");
const mode = process.argv[2];
const dataArg = process.argv.find((arg) => arg.startsWith("--user-data-dir="));
if (
  process.env.OPENBOT_LOCAL_SERVER_CHILD !== "1" ||
  !process.env.OPENBOT_LOCAL_SERVER_SECRET ||
  !path.isAbsolute(process.env.OPENBOT_LOCAL_SERVER_ROOT || "") ||
  !dataArg ||
  !path.isAbsolute(dataArg.slice("--user-data-dir=".length)) ||
  process.env.ELECTRON_RUN_AS_NODE ||
  Object.keys(process.env).some((key) => key.startsWith("OPENBOT_DEV_"))
)
  process.exit(4);
const ready = {
  serverId: `fixture-server-${process.pid}`,
  serverName: process.env.OPENBOT_LOCAL_SERVER_NAME,
  apiUrl: mode === "remote" ? "http://example.com:9090" : "http://127.0.0.1:9090",
  fingerprint: "fixture-fingerprint",
  publicKey: "fixture-public-key",
  ownerMemberId: "fixture-owner",
};
if (mode === "exit") process.exit(2);
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
if (mode !== "wait") {
  process.stdout.write("unrelated startup output\n");
  process.stdout.write("OPENBOT_LOCAL_SERVER_READY ");
  process.stdout.write(JSON.stringify(ready) + "\n");
}
