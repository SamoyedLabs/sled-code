// @effect-diagnostics nodeBuiltinImport:off -- Native encryption identity must be set before Electron initializes its Keychain service.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { app } from "electron";
import { privateDesktopStorageName } from "./app/DesktopStorageIdentity.ts";
require("./compileCache.cjs");
if (app.isPackaged) {
  const metadata = require(NodePath.join(app.getAppPath(), "package.json"));
  if (metadata.sledPrivateEnvironment) {
    Object.assign(NodeProcess.env, metadata.sledPrivateEnvironment);
  }
}
if (NodeProcess.env.SLED_PORTABLE_PROFILE === "true") {
  NodeProcess.env.T3CODE_HOME = NodePath.join(NodeOS.homedir(), ".sled");
}
const privateHome = NodeProcess.env.T3CODE_HOME?.trim();
const privateName = privateHome
  ? privateDesktopStorageName(NodePath.join(privateHome, "userdata", "electron"))
  : undefined;
if (NodeProcess.platform === "darwin" && privateName) app.setName(privateName);
require("./main.cjs");
