function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function projectCarouselIndex({
  scrollLeft,
  slideWidth,
  scrollVelocity,
  slideCount,
  decelerationRate = 0.998,
}) {
  if (!Number.isFinite(slideWidth) || slideWidth <= 0 || !Number.isInteger(slideCount) || slideCount <= 0) {
    return 0;
  }
  const safeRate = clamp(Number(decelerationRate) || 0, 0, 0.999);
  const projection = (Number(scrollVelocity) || 0) / 1000 * safeRate / (1 - safeRate);
  const projectedOffset = (Number(scrollLeft) || 0) + projection;
  return clamp(Math.round(projectedOffset / slideWidth), 0, slideCount - 1);
}

export function shouldDismissThemeSheet({ offsetY, velocityY, sheetHeight }) {
  const distanceThreshold = Math.max(96, (Number(sheetHeight) || 0) * 0.2);
  return (Number(offsetY) || 0) >= distanceThreshold || (Number(velocityY) || 0) >= 650;
}

export function releaseVelocity(samples, releasedAt, valueKey, staleAfter = 120) {
  const first = samples?.[0];
  const last = samples?.[samples.length - 1];
  if (!first || !last || last.time <= first.time || (Number(releasedAt) || 0) - last.time > staleAfter) return 0;
  return ((Number(last[valueKey]) || 0) - (Number(first[valueKey]) || 0)) / ((last.time - first.time) / 1000);
}
