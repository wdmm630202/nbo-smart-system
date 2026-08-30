export async function loadPortfolioAdditions({ fetchImpl, url, fallback, warn = () => {} }) {
  let response;
  try {
    response = await fetchImpl(url, { cache: "no-store" });
  } catch (error) {
    warn("公开增量清单请求失败，继续显示历史客片", error);
    return fallback;
  }
  if (!response.ok) {
    warn(`公开增量清单请求失败（HTTP ${response.status}），继续显示历史客片`);
    return fallback;
  }
  // 解析和合并错误必须传递给调用方，不得伪装成空增量。
  return response.json();
}

export function buildCustomerPortfolio({ catalog, additions, buildItems, buildThemes }) {
  const items = buildItems(catalog, additions);
  const themes = buildThemes(catalog, additions);
  const sceneIds = catalog.scenes.filter(({ id }) => id !== "all").map(({ id }) => id);
  return {
    items,
    themes,
    counts: {
      photos: items.length,
      themes: themes.length,
      scenes: Object.fromEntries(sceneIds.map((scene) => [scene, items.filter((item) => item.scene === scene).length])),
      sceneThemes: Object.fromEntries(sceneIds.map((scene) => [scene, themes.filter((theme) => theme.scene === scene).length])),
    },
  };
}
