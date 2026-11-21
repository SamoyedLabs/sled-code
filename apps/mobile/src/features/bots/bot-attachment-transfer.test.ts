import { OPENBOT_MAX_FILE_BYTES } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  BOT_LARGE_FILE_BYTES,
  botAttachmentDownload,
  firstLargeBotAttachment,
} from "./bot-attachment-transfer";

it("keeps the OpenBot mobile threshold and the existing host transfer cap", () => {
  expect(botAttachmentDownload(undefined)).toBe("standard");
  expect(botAttachmentDownload(BOT_LARGE_FILE_BYTES)).toBe("standard");
  expect(botAttachmentDownload(BOT_LARGE_FILE_BYTES + 1)).toBe("large");
  expect(botAttachmentDownload(OPENBOT_MAX_FILE_BYTES)).toBe("large");
  expect(botAttachmentDownload(OPENBOT_MAX_FILE_BYTES + 1)).toBe("desktop");
});

it("only automatically transfers visible candidates with usable host metadata", () => {
  const eligible = { id: "eligible", name: "example.txt", size: BOT_LARGE_FILE_BYTES + 1 };
  expect(
    firstLargeBotAttachment([
      { id: "", name: "missing-id", size: eligible.size },
      { id: "invalid", name: "invalid-size", size: Infinity },
      { id: "desktop", name: "desktop-only", size: OPENBOT_MAX_FILE_BYTES + 1 },
      eligible,
    ]),
  ).toEqual(eligible);
});
