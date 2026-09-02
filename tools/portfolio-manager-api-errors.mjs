const publicApiCodes = new Set([
  "ASSET_NOT_FOUND",
  "AUTH_REQUIRED",
  "EMPTY_BODY",
  "INVALID_ASSET_ID",
  "INVALID_BATCH_ID",
  "INVALID_BATCH_POSITION",
  "INVALID_CONTENT_LENGTH",
  "INVALID_FILE_NAME",
  "INVALID_IMAGE",
  "INVALID_JSON",
  "INVALID_JSON_BODY",
  "INVALID_OPERATION_ID",
  "INVALID_SLOT_ID",
  "INVALID_STYLE_ID",
  "MUTATION_BUSY",
  "ORIGIN_FORBIDDEN",
  "OPERATION_MISMATCH",
  "PAYLOAD_TOO_LARGE",
  "REQUEST_ABORTED",
  "STYLE_LIBRARY_UNAVAILABLE",
  "STYLE_OPERATION_FAILED",
  "STYLE_VALIDATION_FAILED",
  "UNSUPPORTED_MEDIA_TYPE",
]);

function containsInternalDetail(value) {
  return /\b(?:EACCES|EISDIR|ENOENT|ENOTDIR|EPERM)\b|file:\/\/|(?:^|[^A-Za-z0-9_])\/(?!\/)[^\s"'`()]+|\b[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]/.test(value);
}

export function toApiErrorPayload(error, fallbackStatus = 400) {
  const code = typeof error?.apiCode === "string" ? error.apiCode : "";
  const message = error instanceof Error ? error.message : String(error);
  if (!publicApiCodes.has(code) || containsInternalDetail(message)) {
    return {
      status: 500,
      body: { ok: false, code: "INTERNAL_ERROR", error: "操作未完成，请稍后重试" },
    };
  }
  const requestedStatus = Number(error?.status || fallbackStatus);
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
    ? requestedStatus
    : fallbackStatus;
  return { status, body: { ok: false, code, error: message } };
}
