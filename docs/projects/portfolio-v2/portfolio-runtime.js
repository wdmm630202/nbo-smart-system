import { buildStyleLibrary } from "./style-library.js?v=pv2-2cb70ec7864f";

const defaultWarn = (...args) => console.warn(...args);

export async function loadPortfolioDocument({ fetchImpl, url, fallback, label, warn = defaultWarn }) {
  try {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    warn(`${label}请求失败，继续使用兼容内容`, error);
    return fallback;
  }
}

export async function loadPortfolioAdditions({ fetchImpl, url, fallback, warn = defaultWarn }) {
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
  try {
    return await response.json();
  } catch (error) {
    warn("公开增量清单解析失败，继续显示历史客片", error);
    return fallback;
  }
}

export function buildCustomerPortfolio({ catalog, additions, fallback, buildItems, buildThemes, warn = defaultWarn }) {
  let items;
  let themes;
  try {
    items = buildItems(catalog, additions);
    themes = buildThemes(catalog, additions);
  } catch (error) {
    warn("公开增量清单合并失败，继续显示历史客片", error);
    items = buildItems(catalog, fallback);
    themes = buildThemes(catalog, fallback);
  }
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

export function buildCustomerStyleLibrary({ styleCatalog, assignments, assets, fallback = null, warn = defaultWarn }) {
  try {
    return buildStyleLibrary({ catalog: styleCatalog, assignments, assets });
  } catch (error) {
    warn("风格资料校验失败，继续显示历史客片", error);
    return fallback;
  }
}
