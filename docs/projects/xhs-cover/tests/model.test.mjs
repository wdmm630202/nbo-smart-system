import test from 'node:test';
import assert from 'node:assert/strict';

import * as model from '../src/model.js';

const { coverRect, evidenceFadeStops, evidenceLayout } = model;

test('默认拍摄前照片放大后减少人物四周空白', () => {
  const canvas = { width: 1080, height: 1440 };
  const { frame, imageZoom } = evidenceLayout(canvas);
  const rect = coverRect(1080, 1440, frame, imageZoom);

  assert.equal(imageZoom, 1.3);
  assert.equal(rect.width, 589.875);
  assert.equal(rect.height, 786.5);
});

test('拍摄前照片的溶图区域贴近外层虚线', () => {
  const { imageInset } = evidenceLayout({ width: 1080, height: 1440 });
  const stops = evidenceFadeStops();

  assert.equal(imageInset, 4);
  assert.deepEqual(stops, [
    [0, 0],
    [0.04, 0.78],
    [0.08, 1],
    [0.92, 1],
    [0.96, 0.78],
    [1, 0],
  ]);
});

test('拍摄前后标签沿右侧同一条纵线对齐', () => {
  assert.equal(typeof model.comparisonLabelLayout, 'function');
  const layout = model.comparisonLabelLayout({ width: 1080, height: 1440 });

  assert.equal(layout.after.right, 1032);
  assert.equal(layout.before.right, 1032);
  assert.equal(layout.after.y, 48);
  assert.equal(layout.before.y, 831);
  assert.deepEqual(
    { width: layout.after.width, height: layout.after.height, radius: layout.after.radius },
    { width: 104, height: 54, radius: 27 },
  );
  assert.deepEqual(
    { width: layout.before.width, height: layout.before.height, radius: layout.before.radius },
    { width: 104, height: 54, radius: 27 },
  );
  assert.deepEqual(layout.after.emphasis, { width: 38, height: 38, radius: 19, inset: 8 });
  assert.deepEqual(layout.before.emphasis, { width: 38, height: 38, radius: 19, inset: 8 });
});

test('短胶囊只显示中文并突出前后关键字', () => {
  assert.equal(typeof model.comparisonLabelContent, 'function');
  assert.deepEqual(model.comparisonLabelContent(), {
    prefix: '拍摄',
    after: '后',
    before: '前',
  });
});

test('拍摄两字使用均衡字距', () => {
  assert.equal(typeof model.comparisonLabelTypography, 'function');
  assert.deepEqual(model.comparisonLabelTypography(), { prefixLetterSpacing: 2 });
});

test('两行主标题整体上移并增加行间距', () => {
  assert.equal(typeof model.titleLayout, 'function');
  const layout = model.titleLayout();
  assert.deepEqual(layout, {
    left: 64,
    eyebrowBaseline: 1153,
    line1Baseline: 1240,
    line2Baseline: 1330,
    accent: { x: 64, y: 1378, width: 64, height: 4, radius: 2 },
  });
  assert.equal(layout.accent.x, layout.left);
});

test('高端美业参考版使用克制文案与宋体层级', () => {
  assert.equal(model.DEFAULT_STATE.line1, '无需刻意');
  assert.equal(model.DEFAULT_STATE.line2, '自然自有力量');
  assert.equal(typeof model.titleTypography, 'function');
  assert.deepEqual(model.titleTypography(), {
    eyebrowText: '真实客片 · NANBOART',
    eyebrowSize: 16,
    eyebrowWeight: 500,
    eyebrowLetterSpacing: 4,
    titleSize: 68,
    titleWeight: 600,
    titleLetterSpacing: 1,
    textAlign: 'left',
    accentColor: '#fee800',
  });
});
