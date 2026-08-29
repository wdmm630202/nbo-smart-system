import {
  comparisonLabelContent,
  comparisonLabelLayout,
  comparisonLabelTypography,
  coverRect,
  evidenceLayout,
  evidenceFadeStops,
  titleLayout,
  titleTypography,
} from './model.js';

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

const fitFont = (ctx, text, maxWidth, preferred, min, weight, family) => {
  let size = preferred;
  while (size > min) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
};

const addStops = (gradient, stops) => {
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, `rgba(0,0,0,${alpha})`);
};

const drawBlendedEvidence = (ctx, image, frame, zoom, offsetX, offsetY, inset) => {
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

const drawComparisonLabel = (ctx, prefix, emphasis, layout, typography) => {
  const { right, y, width, height, radius, emphasis: emphasisLayout } = layout;
  const x = right - width;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.38)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 5;
  roundedRect(ctx, x, y, width, height, radius);
  const glass = ctx.createLinearGradient(0, y, 0, y + height);
  glass.addColorStop(0, 'rgba(255,255,255,.18)');
  glass.addColorStop(.18, 'rgba(24,24,24,.42)');
  glass.addColorStop(1, 'rgba(6,6,6,.58)');
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,.36)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const emphasisX = right - emphasisLayout.inset - emphasisLayout.width;
  const emphasisY = y + emphasisLayout.inset;
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  roundedRect(
    ctx,
    emphasisX,
    emphasisY,
    emphasisLayout.width,
    emphasisLayout.height,
    emphasisLayout.radius,
  );
  const emphasisGlass = ctx.createLinearGradient(0, emphasisY, 0, emphasisY + emphasisLayout.height);
  emphasisGlass.addColorStop(0, 'rgba(255,255,255,.98)');
  emphasisGlass.addColorStop(1, 'rgba(235,235,235,.84)');
  ctx.fillStyle = emphasisGlass;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,.74)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 8;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,.76)';
  ctx.font = '540 18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.letterSpacing = `${typography.prefixLetterSpacing}px`;
  ctx.fillText(prefix, x + 12, y + height / 2 + .5);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#151515';
  ctx.font = '760 23px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.letterSpacing = '0px';
  ctx.fillText(
    emphasis,
    emphasisX + emphasisLayout.width / 2,
    emphasisY + emphasisLayout.height / 2 + .5,
  );
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

  const labelLayout = comparisonLabelLayout(state.canvas);
  const labelContent = comparisonLabelContent();
  const labelTypography = comparisonLabelTypography();
  drawComparisonLabel(ctx, labelContent.prefix, labelContent.after, labelLayout.after, labelTypography);

  if (state.mode === 'compare' && images.before) {
    const { frame, imageZoom, imageInset } = evidenceLayout(state.canvas, state.beforeZoom);
    drawBlendedEvidence(ctx, images.before, frame, imageZoom, state.beforeOffsetX, state.beforeOffsetY, imageInset);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.74)';
    ctx.lineWidth = 3;
    ctx.setLineDash([15, 12]);
    roundedRect(ctx, frame.x, frame.y, frame.width, frame.height, frame.radius);
    ctx.stroke();
    ctx.restore();
    drawComparisonLabel(ctx, labelContent.prefix, labelContent.before, labelLayout.before, labelTypography);
  }

  const titlePosition = titleLayout();
  const typography = titleTypography();
  const textX = titlePosition.left;
  const maxWidth = 520;
  const sansFamily = '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  const serifFamily = '"Songti SC", "STSong", "Noto Serif SC", serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = typography.textAlign;
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = 'rgba(255,255,255,.68)';
  ctx.font = `${typography.eyebrowWeight} ${typography.eyebrowSize}px ${sansFamily}`;
  ctx.letterSpacing = `${typography.eyebrowLetterSpacing}px`;
  ctx.fillText(typography.eyebrowText, textX, titlePosition.eyebrowBaseline);
  ctx.letterSpacing = '0px';

  ctx.letterSpacing = `${typography.titleLetterSpacing}px`;
  const line1Size = fitFont(
    ctx,
    state.line1,
    maxWidth,
    typography.titleSize,
    46,
    typography.titleWeight,
    serifFamily,
  );
  ctx.font = `${typography.titleWeight} ${line1Size}px ${serifFamily}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(state.line1, textX, titlePosition.line1Baseline);

  const line2Size = fitFont(
    ctx,
    state.line2,
    maxWidth,
    typography.titleSize,
    46,
    typography.titleWeight,
    serifFamily,
  );
  ctx.font = `${typography.titleWeight} ${line2Size}px ${serifFamily}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(state.line2, textX, titlePosition.line2Baseline);
  ctx.letterSpacing = '0px';

  const { accent } = titlePosition;
  roundedRect(ctx, accent.x, accent.y, accent.width, accent.height, accent.radius);
  ctx.fillStyle = typography.accentColor;
  ctx.fill();
  ctx.shadowColor = 'transparent';
}
