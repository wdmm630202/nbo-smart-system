export const POSTER = { width: 6000, height: 8000 };
export const PHOTO_AREA = { x: 13, y: 232, width: 5974, height: 7755 };

const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));

export function clampSplit(value) {
  return clamp(value, 0, 1, .5);
}

export function getPanes(split, renderWidth = POSTER.width) {
  const fraction = clampSplit(split);
  const pixelsPerUnit = Math.max(1, Number.isFinite(renderWidth) ? renderWidth : POSTER.width) / POSTER.width;
  const requestedBoundary = PHOTO_AREA.x + PHOTO_AREA.width * fraction;
  // One shared integer render-pixel boundary prevents both clips from partially
  // compositing onto white. Keep the original outer edges, including 0/100%.
  const boundary = fraction === 0 ? PHOTO_AREA.x : fraction === 1 ? PHOTO_AREA.x + PHOTO_AREA.width :
    clamp(Math.round(requestedBoundary * pixelsPerUnit) / pixelsPerUnit, PHOTO_AREA.x, PHOTO_AREA.x + PHOTO_AREA.width, requestedBoundary);
  const width = boundary - PHOTO_AREA.x;
  return [
    { ...PHOTO_AREA, width },
    { ...PHOTO_AREA, x: boundary, width: PHOTO_AREA.x + PHOTO_AREA.width - boundary },
  ];
}

// Pan is normalized to [-1, 1] of each axis's available crop margin.
// A shared scale preserves source aspect ratio, even at a zero-width split edge.
export function coverImage(pane, sourceWidth, sourceHeight, zoom = 1, panX = 0, panY = 0) {
  const safeWidth = Math.max(1, Number.isFinite(sourceWidth) ? sourceWidth : 1);
  const safeHeight = Math.max(1, Number.isFinite(sourceHeight) ? sourceHeight : 1);
  const scale = Math.max(pane.width / safeWidth, pane.height / safeHeight) * clamp(zoom, 1, 4, 1);
  const width = safeWidth * scale;
  const height = safeHeight * scale;
  const marginX = Math.max(0, (width - pane.width) / 2);
  const marginY = Math.max(0, (height - pane.height) / 2);
  return {
    x: pane.x - marginX + clamp(panX, -1, 1, 0) * marginX,
    y: pane.y - marginY + clamp(panY, -1, 1, 0) * marginY,
    width, height, marginX, marginY,
  };
}
