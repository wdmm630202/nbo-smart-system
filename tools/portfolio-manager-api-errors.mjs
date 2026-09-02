const publicApiCodes = new Set([
  "ASSET_NOT_FOUND",
  "AUTH_REQUIRED",
  "BAD_REQUEST",
  "EMPTY_BODY",
  "INVALID_ASSET_ID",
  "INVALID_BATCH_ID",
  "INVALID_BATCH_POSITION",
  "INVALID_CONTENT_LENGTH",
  "INVALID_FILE_NAME",
  "INVALID_IMAGE",
  "INVALID_IMAGE_DIMENSIONS",
  "INVALID_IMAGE_FORMAT",
  "INVALID_IMAGE_RATIO",
  "INVALID_IMAGE_TYPE",
  "INVALID_JSON",
  "INVALID_JSON_BODY",
  "INVALID_OPERATION_ID",
  "INVALID_PHOTO_ID",
  "INVALID_SLOT_ID",
  "INVALID_STYLE_ID",
  "MUTATION_BUSY",
  "NO_UNDO_BACKUP",
  "ORIGIN_FORBIDDEN",
  "OPERATION_MISMATCH",
  "PAYLOAD_TOO_LARGE",
  "REQUEST_ABORTED",
  "PUBLISH_DIRTY_WORKTREE",
  "PUBLISH_DIVERGED",
  "PUBLISH_INCOMPLETE_BUNDLE",
  "PUBLISH_LOCAL_AHEAD",
  "PUBLISH_REMOTE_AHEAD",
  "PUBLISH_STAGED_CHANGES",
  "PUBLISH_UNREGISTERED_FILE",
  "PUBLISH_VALIDATION_FAILED",
  "PUBLISH_WRONG_BRANCH",
  "STYLE_LIBRARY_UNAVAILABLE",
  "STYLE_OPERATION_FAILED",
  "STYLE_VALIDATION_FAILED",
  "UNSUPPORTED_MEDIA_TYPE",
]);

// The older draft library predates typed API errors. These messages are fixed
// user-input validation messages (not interpolated filesystem or request
// values), so retain the useful 4xx response while all other untyped failures
// stay private.
const legacyPublicValidationMessages = new Set([
  "只支持 JPG、PNG 或 WebP 图片",
  "无法读取这张图片的尺寸",
  "进入待公开前必须填写场景、主题、风格和公开授权",
  "图片文件名无效",
  "草稿编号无效",
  "草稿图片路径无效",
  "客片路径无效",
  "草稿预览会话已过期，请刷新页面后重试",
]);

function containsInternalDetail(value) {
  return /\b(?:EACCES|EISDIR|ENOENT|ENOTDIR|EPERM)\b|file:\/\/|(?:^|[^A-Za-z0-9_])\/(?!\/)[^\s"'`()]+|\b[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]/.test(value);
}

export function toApiErrorPayload(error, fallbackStatus = 400) {
  const code = typeof error?.apiCode === "string" ? error.apiCode : "";
  const message = error instanceof Error ? error.message : String(error);
  const legacyValidation = !code && legacyPublicValidationMessages.has(message);
  if (legacyValidation && !containsInternalDetail(message)) {
    const requestedStatus = Number(error?.status || fallbackStatus);
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : fallbackStatus;
    return { status, body: { ok: false, code: "BAD_REQUEST", error: message } };
  }
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
