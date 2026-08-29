import { coverRect, evidenceLayout, evidenceFadeStops } from './model.js';

const roundedRect = (ctx, x, y, width, height, radius) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
};

const drawCoverImage = (ctx, image, frame, zoom, offsetX, offsetY) => {
  const rect = coverRect(image.naturalWidth, image.naturalHeight, frame, zoom, offsetX, offsetY);
  ctx.save();
  roundedRect(ctx, frame.x, frame.y, frame.width, frame.height, frame.radius || 0);
  ctx.clip();
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
};

const fitFont = (ctx, text, maxWidth, preferred, min = 46) => {
  let size = preferred;
  while (size > min) {
    ctx.font = `850 ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
};

const addStops = (gradient, stops) => {
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, `rgba(0,0,0,${alpha})`);
};

const drawBlendedEvidence = (ctx, image, frame, zoom, offsetX, offsetY) => {
  const inset = 10;
  const inner = {
    x: frame.x + inset,
    y: frame.y + inset,
    width: frame.width - inset * 2,
    height: frame.height - inset * 2,
  };
  const buffer = document.createElement('canvas');
  buffer.width = inner.width;
  buffer.height = inner.height;
  const bufferCtx = buffer.getContext('2d');
  drawCoverImage(
    bufferCtx,
    image,
    { x: 0, y: 0, width: inner.width, height: inner.height, radius: 0 },
    zoom,
    offsetX,
    offsetY,
  );

  const stops = evidenceFadeStops();
  bufferCtx.globalCompositeOperation = 'destination-in';
  const horizontal = bufferCtx.createLinearGradient(0, 0, inner.width, 0);
  addStops(horizontal, stops);
  bufferCtx.fillStyle = horizontal;
  bufferCtx.fillRect(0, 0, inner.width, inner.height);
  const vertical = bufferCtx.createLinearGradient(0, 0, 0, inner.height);
  addStops(vertical, stops);
  bufferCtx.fillStyle = vertical;
  bufferCtx.fillRect(0, 0, inner.width, inner.height);

  ctx.drawImage(buffer, inner.x, inner.y);
};

const drawBilingualLabel = (ctx, chinese, english, x, y, width = 142) => {
  ctx.save();
  ctx.fillStyle = 'rgba(12,12,12,.54)';
  ctx.strokeStyle = 'rgba(255,255,255,.42)';
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y, width, 82, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '760 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.fillText(chinese, x + 18, y + 34);
  ctx.fillStyle = 'rgba(255,255,255,.68)';
  ctx.font = '800 15px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText(english, x + 18, y + 62);
  ctx.letterSpacing = '0px';
  ctx.restore();
};

export function renderCover(ctx, state, images) {
  const { width, height } = state.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#242420';
  ctx.fillRect(0, 0, width, height);

  if (images.after) {
    drawCoverImage(ctx, images.after, { x: 0, y: 0, width, height }, state.zoom, state.offsetX, state.offsetY);
  } else {
    ctx.fillStyle = '#4a4a45';
    ctx.textAlign = 'center';
    ctx.font = '650 38px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText('添加成片后在这里预览', width / 2, height / 2);
    ctx.textAlign = 'left';
  }

  const shade = ctx.createLinearGradient(0, height * .45, 0, height);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(.48, 'rgba(0,0,0,.22)');
  shade.addColorStop(1, 'rgba(0,0,0,.92)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  const topShade = ctx.createLinearGradient(0, 0, 0, height * .26);
  topShade.addColorStop(0, 'rgba(0,0,0,.18)');
  topShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, width, height * .26);

  drawBilingualLabel(ctx, '拍摄后', 'AFTER', width - 184, 48, 136);

  if (state.mode === 'compare' && images.before) {
    const { frame, imageZoom } = evidenceLayout(state.canvas, state.beforeZoom);
    drawBlendedEvidence(ctx, images.before, frame, imageZoom, state.beforeOffsetX, state.beforeOffsetY);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.74)';
    ctx.lineWidth = 3;
    ctx.setLineDash([15, 12]);
    roundedRect(ctx, frame.x, frame.y, frame.width, frame.height, frame.radius);
    ctx.stroke();
    ctx.restore();
    drawBilingualLabel(ctx, '拍摄前', 'BEFORE', frame.x + 24, frame.y + 24, 142);
  }

  const textX = 64;
  const maxWidth = 520;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = '#FEE800';
  ctx.beginPath();
  ctx.arc(textX + 8, 1163, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.80)';
  ctx.font = '720 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('真实到店客片', textX + 34, 1171);
  ctx.letterSpacing = '0px';

  const line1Size = fitFont(ctx, state.line1, maxWidth, 74);
  ctx.font = `850 ${line1Size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(state.line1, textX, 1256);

  const line2Size = fitFont(ctx, state.line2, maxWidth, 74);
  ctx.font = `850 ${line2Size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(state.line2, textX, 1338);
  ctx.shadowColor = 'transparent';
}
