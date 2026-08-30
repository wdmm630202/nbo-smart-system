export const portfolioCatalog = Object.freeze({
  schemaVersion: 1,
  photoCount: 158,
  pairCount: 79,
  scenes: [
    { id: "all", label: "全部", description: "158 张真实客片" },
    { id: "indoor", label: "内景", description: "灯光、造型与布景更可控" },
    { id: "outdoor", label: "外景", description: "环境、行走与故事感更自然" },
  ],
  categories: [
    { id: "business", label: "商务", description: "利落、稳重、有气场" },
    { id: "relaxed", label: "松弛", description: "清爽、自然、不用端着" },
    { id: "mood", label: "情绪", description: "克制、安静、有故事" },
    { id: "creative", label: "创意", description: "鲜明、特别、有记忆点" },
  ],
  // 每个数字是一组双图；同组客片保持同一气质和主题。
  categorySeries: {
    business: [3, 9, 11, 17, 18, 20, 21, 26, 36, 38, 45, 50, 58, 69, 70],
    relaxed: [12, 16, 19, 22, 23, 25, 27, 28, 30, 31, 32, 33, 41, 53, 55, 61, 74, 76],
    mood: [6, 7, 13, 15, 29, 34, 35, 39, 42, 43, 44, 46, 47, 49, 54, 59, 68, 71, 73, 79],
    creative: [1, 2, 4, 5, 8, 10, 14, 24, 37, 40, 48, 51, 52, 56, 57, 60, 62, 63, 64, 65, 66, 67, 72, 75, 77, 78],
  },
  themes: [
    { id: "business-boss", scene: "indoor", label: "商务总裁", description: "西装、职业与气场", series: [3, 9, 11, 20, 46] },
    { id: "magazine", scene: "indoor", label: "杂志肖像", description: "时装、高级与镜头张力", series: [5, 6, 26, 50, 58, 64, 67, 69, 70] },
    { id: "light-mood", scene: "indoor", label: "光影情绪", description: "明暗层次与故事感", series: [15, 17, 34, 35, 36, 47, 59, 73] },
    { id: "retro-hk", scene: "indoor", label: "复古港风", description: "暖调、旧时光与电影感", series: [16, 18, 74] },
    { id: "home-korean", scene: "indoor", label: "居家韩系", description: "干净、生活感与松弛感", series: [32, 33, 54, 71] },
    { id: "floral-boy", scene: "indoor", label: "花艺少年", description: "鲜明色彩与柔和气质", series: [2, 38, 65] },
    { id: "boxing", scene: "indoor", label: "拳击荷尔蒙", description: "肌肉线条与力量感", series: [8, 77] },
    { id: "sport-style", scene: "indoor", label: "运动型格", description: "网球、滑板与少年感", series: [61, 63, 76, 79] },
    { id: "cyberpunk", scene: "indoor", label: "赛博朋克", description: "霓虹、色光与未来感", series: [7, 42, 66, 72] },
    { id: "wuxia", scene: "indoor", label: "国风武侠", description: "东方造型与侠气", series: [13, 48, 52, 75] },
    { id: "celebration", scene: "indoor", label: "生日节日", description: "生日、新年与冬日限定", series: [4, 10, 14, 41, 78] },
    { id: "concept", scene: "indoor", label: "创意概念", description: "道具、投影与实验画面", series: [1, 37, 45, 49, 51, 60, 62, 68] },
    { id: "pet", scene: "indoor", label: "宠物合拍", description: "人与宠物的真实互动", series: [12] },
    { id: "city-street", scene: "outdoor", label: "都市街拍", description: "建筑线条与城市时装", series: [19, 28] },
    { id: "daily-walk", scene: "outdoor", label: "日常漫游", description: "自然光、行走与松弛感", series: [22, 23, 25, 30, 31, 53] },
    { id: "moto", scene: "outdoor", label: "机车型格", description: "金属、速度与痞帅感", series: [24, 56] },
    { id: "city-night", scene: "outdoor", label: "城市夜景", description: "雨夜、霓虹与情绪氛围", series: [43, 44, 55] },
    { id: "forest", scene: "outdoor", label: "森系文艺", description: "绿意、逆光与安静氛围", series: [39] },
    { id: "campus", scene: "outdoor", label: "校园少年", description: "乐器、青春与阳光感", series: [27] },
    { id: "formal-outdoor", scene: "outdoor", label: "正装外景", description: "职业形象与城市光线", series: [21] },
    { id: "wuxia-outdoor", scene: "outdoor", label: "国风外景", description: "古建筑、园林与东方意境", series: [40] },
    { id: "travel", scene: "outdoor", label: "旅行叙事", description: "远方、风景与人物故事", series: [29] },
    { id: "sport-documentary", scene: "outdoor", label: "运动纪实", description: "棒球、场地与动态感", series: [57] },
  ],
  featuredIds: [137, 37, 115, 127, 111, 77, 107, 51, 81, 129, 11, 59, 93, 139, 147, 157, 45, 49, 73, 99, 21, 65, 85, 119, 13, 95, 105, 123, 143, 31],
  heroAssetIds: [13, 21, 31, 37, 77, 79, 85, 111, 127, 137, 154],
});

export const emptyPortfolioAdditions = Object.freeze({ schemaVersion: 1, themes: [], photos: [] });

export function normalizePortfolioAdditions(value = emptyPortfolioAdditions) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.themes) || !Array.isArray(value.photos)) {
    throw new Error("公开增量清单格式无效");
  }
  const ids = new Set();
  const photos = value.photos.map((photo) => {
    const id = Number(photo.id);
    if (!Number.isInteger(id) || id <= portfolioCatalog.photoCount) {
      throw new Error(`新增客片 NB-${String(id).padStart(3, "0")} 与历史编号冲突`);
    }
    if (ids.has(id)) throw new Error(`新增客片 NB-${String(id).padStart(3, "0")} 重复`);
    ids.add(id);
    return { ...photo, id, code: `NB-${String(id).padStart(3, "0")}`, featured: photo.featured === true, isHeroAsset: false };
  });
  return { schemaVersion: 1, themes: value.themes.map((theme) => ({ ...theme })), photos };
}

function buildLegacyPortfolioItems(catalog = portfolioCatalog) {
  const sceneById = Object.fromEntries(catalog.scenes.map((item) => [item.id, item]));
  const titleByCategory = Object.fromEntries(catalog.categories.map((item) => [item.id, item.label]));
  const categorySeries = Object.fromEntries(
    Object.entries(catalog.categorySeries).map(([id, series]) => [id, new Set(series)]),
  );
  const themes = catalog.themes.map((theme) => ({ ...theme, series: new Set(theme.series) }));

  function itemFromId(id) {
    const series = Math.ceil(id / 2);
    const category = Object.entries(categorySeries).find(([, numbers]) => numbers.has(series))?.[0] || "creative";
    const theme = themes.find((item) => item.series.has(series));
    if (!theme) throw new Error(`客片 NB-${String(id).padStart(3, "0")} 还没有归入主题`);
    return {
      id,
      code: `NB-${String(id).padStart(3, "0")}`,
      series,
      category,
      scene: theme.scene,
      sceneTitle: sceneById[theme.scene].label,
      theme: theme.id,
      title: theme.label,
      styleTitle: titleByCategory[category],
      isHeroAsset: catalog.heroAssetIds.includes(id),
    };
  }

  const remainingA = Array.from({ length: catalog.pairCount }, (_, index) => index * 2 + 1)
    .filter((id) => !catalog.featuredIds.includes(id));
  const variantB = Array.from({ length: catalog.pairCount }, (_, index) => index * 2 + 2);
  return [...catalog.featuredIds, ...remainingA, ...variantB].map(itemFromId);
}

export function buildPortfolioItems(catalog = portfolioCatalog, additions = emptyPortfolioAdditions) {
  const legacy = buildLegacyPortfolioItems(catalog);
  const normalized = normalizePortfolioAdditions(additions);
  const published = normalized.photos
    .filter((photo) => photo.visibility === "published")
    .sort((a, b) => a.id - b.id);
  return [...legacy, ...published];
}

export function buildPortfolioThemes(catalog = portfolioCatalog, additions = emptyPortfolioAdditions) {
  const normalized = normalizePortfolioAdditions(additions);
  const publishedIds = new Set(normalized.photos.filter((photo) => photo.visibility === "published").map((photo) => photo.id));
  const newThemes = normalized.themes.filter((theme) => publishedIds.has(Number(theme.coverPhotoId))
    && normalized.photos.some((photo) => photo.visibility === "published" && photo.theme === theme.id));
  return [...catalog.themes, ...newThemes];
}
