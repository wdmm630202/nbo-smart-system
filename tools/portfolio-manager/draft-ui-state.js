export function draftCode(id) {
  return `NB-${String(id).padStart(3, "0")}`;
}

export function filterDrafts(drafts, status = "all") {
  if (status === "all") return [...drafts];
  return drafts.filter((draft) => draft.status === status);
}

export function reconcileSelectedDraftId(selectedId, drafts, status = "all") {
  if (!selectedId) return 0;
  return filterDrafts(drafts, status).some(({ id }) => id === selectedId) ? selectedId : 0;
}

export function publicationControlState(status = {}) {
  const dirtySlots = Array.isArray(status.dirtySlots) ? status.dirtySlots : [];
  const pendingIds = Array.isArray(status.pendingPublicationIds) ? status.pendingPublicationIds : dirtySlots;
  const unrelatedFiles = Array.isArray(status.unrelatedFiles) ? status.unrelatedFiles : [];
  const hasPendingPublication = status.hasPendingPublication === true;
  const pendingCount = pendingIds.length;
  const pendingSummary = pendingCount
    ? `${pendingCount} 张客片将同步`
    : "有待同步状态变更";
  return {
    hasPendingPublication,
    pendingCount,
    pendingSummary,
    pendingLabel: pendingIds.length
      ? pendingIds.map(draftCode).join("、")
      : "有待同步状态变更",
    buttonDisabled: !hasPendingPublication || unrelatedFiles.length > 0 || status.branch !== "main",
    title: pendingCount
      ? `有 ${pendingCount} 张客片等待同步`
      : (hasPendingPublication ? "有待同步状态变更" : "本地客片库已就绪"),
    description: hasPendingPublication
      ? "新增、隐藏或恢复目前只保存在本机；请检查预览，只有同步成功后网站才会更新。"
      : "现在可以选一张客片开始替换。",
  };
}

export function canPrepareDraft(draft, metadata, busy = false) {
  return Boolean(
    !busy
    && draft?.status === "draft"
    && metadata?.scene
    && metadata?.theme
    && metadata?.category
    && metadata?.approvedForPublicUse === true,
  );
}

export function setExpandedPanel({ panel, trigger, feedback, firstField }, show) {
  panel.hidden = !show;
  trigger.setAttribute("aria-expanded", String(show));
  if (show) {
    firstField.focus();
  } else {
    feedback.textContent = "";
    trigger.focus();
  }
}

function draftStatusPresentation(draft) {
  if (draft.status === "ready" && draft.stagedAt) {
    return {
      label: "已加入本地预览",
      note: "已加入本地网站预览；不会自动同步到线上网站，同步仍需独立确认。",
    };
  }
  return {
    draft: { label: "草稿", note: "仅本机可见，完成分类和授权后才能准备公开。" },
    ready: { label: "待公开", note: "已完成分类与授权，可加入本地网站预览。" },
    published: { label: "已公开", note: "已同步到网站，需要下线时可安全归档。" },
    archived: { label: "已归档", note: "编号和本地资产已保留，可随时恢复。" },
  }[draft.status] || { label: draft.status, note: "" };
}

export function draftEditorState(draft) {
  const presentation = draftStatusPresentation(draft);
  const stagedReady = draft.status === "ready" && Boolean(draft.stagedAt);
  const editable = draft.status === "draft";
  return {
    editable,
    showSave: editable,
    showReady: editable,
    showArchive: draft.status !== "archived",
    showRestore: draft.status === "archived" || (draft.status === "ready" && !stagedReady),
    restoreLabel: draft.status === "ready" ? "返回草稿编辑" : "恢复草稿",
    showStage: draft.status === "ready" && !stagedReady,
    archiveLabel: stagedReady
      ? "从本地网站预览隐藏"
      : (draft.status === "published" ? "从网站隐藏" : "归档草稿"),
    statusLabel: presentation.label,
    statusNote: presentation.note,
  };
}

export function restoreActionForDraft(draft) {
  if (draft.status === "ready" && draft.stagedAt) return null;
  if (draft.status === "archived" && (draft.stagedAt || draft.publishedCommit)) {
    return { path: "/api/public/visibility", body: { visibility: "published" } };
  }
  if (draft.status === "ready" || draft.status === "archived") {
    return { path: "/api/drafts/restore", body: null };
  }
  return null;
}

export function stageActionForDraft(draft) {
  if (draft.status !== "ready" || draft.stagedAt) return null;
  return { path: "/api/drafts/stage", body: null };
}

export function archiveActionForDraft(draft) {
  if (draft.status === "published" || draft.stagedAt) {
    return {
      path: "/api/public/visibility",
      body: { visibility: "archived" },
      successMessage: draft.status === "ready"
        ? "已从本地网站预览隐藏；本次隐藏只保存在本机，同步成功后网站才会更新。"
        : "已从网站清单隐藏；本次隐藏只保存在本机，同步成功后网站才会更新。",
    };
  }
  if (draft.status === "draft" || draft.status === "ready") {
    return {
      path: "/api/drafts/archive",
      body: null,
      successMessage: "草稿已归档，编号和本地资产保留。",
    };
  }
  return null;
}

function uploadSnapshot(results) {
  return results.map((result) => ({ ...result }));
}

export async function uploadDraftFilesSequentially(files, uploadFile, onProgress = () => {}) {
  const results = files.map((file) => ({ file: file.name, status: "pending" }));
  onProgress(uploadSnapshot(results));
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const result = await uploadFile(file);
      results[index] = {
        file: file.name,
        status: "success",
        code: result.code || draftCode(result.id),
      };
    } catch (error) {
      results[index] = {
        file: file.name,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    onProgress(uploadSnapshot(results));
  }
  return uploadSnapshot(results);
}
