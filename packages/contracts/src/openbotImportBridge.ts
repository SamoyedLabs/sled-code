import { ImportRequest } from "./openbotAgentImport.ts";
import * as Schema from "effect/Schema";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
export const OpenbotImportContextInput = Schema.Struct({ hostId: Id });
export const OpenbotImportContext = Schema.Struct({
  hostId: Id,
  principalId: Id,
  available: Schema.Boolean,
});
export const OpenbotArchiveUploadInput = Schema.Struct({
  hostId: Id,
  principalId: Id,
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(255),
    Schema.isPattern(/^[^/\\\u0000-\u001f]+\.zip$/i),
  ),
  size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 104857600 })),
});
export type OpenbotArchiveUploadInput = typeof OpenbotArchiveUploadInput.Type;
export const OpenbotArchiveUpload = Schema.Struct({ uploadId: Id, relativeUrl: Schema.String });

export const OpenbotBoundImportRequest = Schema.Struct({ principalId: Id, request: ImportRequest });
