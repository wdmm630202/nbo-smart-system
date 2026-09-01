const scenes = [
  ["IN", "indoor"],
  ["OUT", "outdoor"],
];

function clone(value) {
  return structuredClone(value);
}

export function fixtureAssets() {
  return scenes.flatMap(([prefix, scene], sceneIndex) => Array.from({ length: 9 }, (_, index) => {
    const id = sceneIndex * 9 + index + 1;
    return {
      id,
      scene,
      theme: `${prefix.toLowerCase()}-theme-${String(index + 1).padStart(2, "0")}`,
      thumb: `/assets/photos/thumbs/photo-${String(id).padStart(3, "0")}.webp`,
      full: `/assets/photos/full/photo-${String(id).padStart(3, "0")}.jpg`,
    };
  }));
}

export function fixtureStyleCatalog() {
  const families = [];
  const styles = [];
  for (const [prefix, scene] of scenes) {
    for (let familyOrder = 1; familyOrder <= 6; familyOrder += 1) {
      const familyId = `${prefix}-${String(familyOrder).padStart(2, "0")}`;
      families.push({
        id: familyId,
        scene,
        label: `${scene} 大类 ${familyOrder}`,
        description: `${scene} 大类 ${familyOrder} 的拍摄方向`,
        order: familyOrder,
      });
      for (let styleOrder = 1; styleOrder <= 11; styleOrder += 1) {
        styles.push({
          id: `ST-${prefix}-${String(familyOrder).padStart(2, "0")}-${String(styleOrder).padStart(2, "0")}`,
          familyId,
          scene,
          label: `${scene} 风格 ${familyOrder}-${styleOrder}`,
          audience: `适合需要 ${scene} 拍摄效果的男士 ${familyOrder}-${styleOrder}`,
          description: `这是 ${scene} 第 ${familyOrder} 大类第 ${styleOrder} 个风格的说明`,
          legacyThemeIds: [`${prefix.toLowerCase()}-theme-01`],
          order: styleOrder,
          visibility: "published",
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    families,
    styles,
    featuredStyleIds: [
      "ST-IN-01-01",
      "ST-IN-02-01",
      "ST-IN-03-01",
      "ST-IN-04-01",
      "ST-OUT-01-01",
      "ST-OUT-02-01",
      "ST-OUT-03-01",
      "ST-OUT-04-01",
    ],
  };
}

export function fixtureAssignments({ firstSlots } = {}) {
  const catalog = fixtureStyleCatalog();
  const assignments = Object.fromEntries(catalog.styles.map((style) => {
    const firstAssetId = style.scene === "indoor" ? 1 : 10;
    const slots = Array.from({ length: 9 }, (_, index) => ({
      assetId: firstAssetId + index,
      poseLabel: `拍摄参考 ${index + 1}`,
      source: "seed",
      updatedAt: null,
    }));
    return [style.id, {
      slots: style.id === "ST-IN-01-01" && firstSlots ? clone(firstSlots) : slots,
      coverPosition: 1,
      maturity: "reference",
      updatedAt: null,
    }];
  }));
  return { schemaVersion: 1, assignments };
}
