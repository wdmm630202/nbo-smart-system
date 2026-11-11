import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSplit, getPanes, coverImage } from '../apps/portrait-makeover/geometry.mjs';

// Catch split rounding, out-of-bounds partitions, stretched images and unclamped panning.
test('half and asymmetric panes meet exactly and fill the photo area', () => {
  const half = getPanes(.5);
  assert.deepEqual(half, [{ x: 6, y: 115, width: 1494, height: 3879 }, { x: 1500, y: 115, width: 1494, height: 3879 }]);
  const asymmetric = getPanes(.25);
  assert.deepEqual(asymmetric, [{ x: 6, y: 115, width: 747, height: 3879 }, { x: 753, y: 115, width: 2241, height: 3879 }]);
});

// A fractional clip boundary antialiases both photos over the white underfill.
// Catch a seam by requiring one shared boundary on the actual output pixel grid.
test('fractional splits snap the shared boundary to preview and export pixels', () => {
  for (const { split, renderWidth, boundary } of [
    { split: .125, renderWidth: 3000, boundary: 380 },
    { split: .376, renderWidth: 3000, boundary: 1129 },
    { split: .321, renderWidth: 3000, boundary: 965 },
    { split: .125, renderWidth: 900, boundary: 380 },
    { split: .376, renderWidth: 900, boundary: 1130 },
    { split: .321, renderWidth: 900, boundary: 966.6666666666666 },
  ]) {
    const [left, right] = getPanes(split, renderWidth);
    assert.ok(Math.abs(right.x - boundary) < 1e-9);
    assert.equal(left.x + left.width, right.x);
    const pixelBoundary = right.x * renderWidth / 3000;
    assert.ok(Math.abs(pixelBoundary - Math.round(pixelBoundary)) < 1e-9);
    assert.equal(left.x, 6);
    assert.equal(right.x + right.width, 2994);
  }
});

test('pixel snapping preserves zero and full width panes at each render size', () => {
  for (const renderWidth of [900, 3000]) {
    assert.deepEqual(getPanes(0, renderWidth).map((pane) => [pane.x, pane.width]), [[6, 0], [6, 2988]]);
    assert.deepEqual(getPanes(1, renderWidth).map((pane) => [pane.x, pane.width]), [[6, 2988], [2994, 0]]);
  }
});

test('split clamps to the usable range and handles invalid numbers', () => {
  assert.equal(clampSplit(-2), 0);
  assert.equal(clampSplit(8), 1);
  assert.equal(clampSplit(.3), .3);
  assert.equal(clampSplit(NaN), .5);
});

test('wide and tall sources cover the pane without stretching', () => {
  const pane = { x: 10, y: 20, width: 100, height: 200 };
  assert.deepEqual(coverImage(pane, 400, 200), { x: -140, y: 20, width: 400, height: 200, marginX: 150, marginY: 0 });
  assert.deepEqual(coverImage(pane, 100, 400), { x: 10, y: -80, width: 100, height: 400, marginX: 0, marginY: 100 });
});

test('zoom and normalized pan are clamped so all pane edges stay covered', () => {
  const pane = { x: 10, y: 20, width: 100, height: 200 };
  assert.deepEqual(coverImage(pane, 400, 200, 2, 99, -99), { x: 10, y: -180, width: 800, height: 400, marginX: 350, marginY: 100 });
  assert.deepEqual(coverImage(pane, 400, 200, -4), { x: -140, y: 20, width: 400, height: 200, marginX: 150, marginY: 0 });
  assert.equal(coverImage(pane, 100, 200, 999).width, 400);
});

test('zero-width edge panes produce only finite values', () => {
  for (const split of [0, 1]) {
    const panes = getPanes(split);
    assert.equal(panes[0].width + panes[1].width, 2988);
    for (const pane of panes) {
      const placement = coverImage(pane, 300, 800, 4, 1, -1);
      assert.ok(Object.values(placement).every(Number.isFinite));
      assert.ok(placement.x <= pane.x);
      assert.ok(placement.x + placement.width >= pane.x + pane.width);
      assert.ok(placement.y <= pane.y);
      assert.ok(placement.y + placement.height >= pane.y + pane.height);
    }
  }
});
