import { buildPortfolioVersion, validatePortfolioLibrary } from "./portfolio-photo-lib.mjs";

const result = await validatePortfolioLibrary();
if (!result.ok) {
  console.error("南铂客片库校验失败：");
  result.errors.forEach((message) => console.error(`- ${message}`));
  process.exitCode = 1;
} else {
  const version = await buildPortfolioVersion();
  console.log(`客片库正常：${result.photoCount} 张照片 · ${result.themeCount} 个主题 · ${result.heroAssetCount} 张首页图`);
  console.log(`${result.uniqueStyleAssetCount} unique assets · ${result.styleCount} styles · ${result.styleSlotCount} slots`);
  console.log(`资源版本：${version}`);
}
if (result.warnings.length) {
  console.warn("提醒：");
  result.warnings.forEach((message) => console.warn(`- ${message}`));
}
