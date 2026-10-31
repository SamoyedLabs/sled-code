// @effect-diagnostics nodeBuiltinImport:off -- Native encryption identity must be set before Electron initializes its Keychain service.
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { app } from "electron";
import { privateDesktopStorageName } from "./app/DesktopStorageIdentity.ts";
require("./compileCache.cjs");
const privateHome = NodeProcess.env.T3CODE_HOME?.trim();
const privateName = privateHome
  ? privateDesktopStorageName(NodePath.join(privateHome, "userdata", "electron"))
  : undefined;
if (NodeProcess.platform === "darwin" && privateName) app.setName(privateName);
require("./main.cjs");
