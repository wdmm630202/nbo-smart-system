import assert from "node:assert/strict";
import test from "node:test";

import {
  projectCarouselIndex,
  releaseVelocity,
  shouldDismissThemeSheet,
} from "../apps/portfolio-v2/interaction-model.js";

test("carousel projects release velocity before snapping to a slide", () => {
  assert.equal(projectCarouselIndex({
    scrollLeft: 390,
    slideWidth: 390,
    scrollVelocity: 0,
    slideCount: 10,
  }), 1);

  assert.equal(projectCarouselIndex({
    scrollLeft: 430,
    slideWidth: 390,
    scrollVelocity: 900,
    slideCount: 10,
  }), 2);

  assert.equal(projectCarouselIndex({
    scrollLeft: 250,
    slideWidth: 390,
    scrollVelocity: -900,
    slideCount: 10,
  }), 0);

  assert.equal(projectCarouselIndex({
    scrollLeft: 3510,
    slideWidth: 390,
    scrollVelocity: 1400,
    slideCount: 10,
  }), 9);
});

test("theme sheet dismisses only after a deliberate downward gesture", () => {
  assert.equal(shouldDismissThemeSheet({ offsetY: 70, velocityY: 200, sheetHeight: 700 }), false);
  assert.equal(shouldDismissThemeSheet({ offsetY: 150, velocityY: 200, sheetHeight: 700 }), true);
  assert.equal(shouldDismissThemeSheet({ offsetY: 32, velocityY: 720, sheetHeight: 700 }), true);
  assert.equal(shouldDismissThemeSheet({ offsetY: -80, velocityY: -900, sheetHeight: 700 }), false);
});

test("release velocity ignores a gesture that paused before release", () => {
  const samples = [
    { time: 100, position: 0 },
    { time: 160, position: 72 },
  ];
  assert.equal(releaseVelocity(samples, 170, "position"), 1200);
  assert.equal(releaseVelocity(samples, 310, "position"), 0);
});
