import type { EditorDocument, EditorLayer } from "./layer-model";

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const proposed = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(proposed).width > maxWidth) {
        lines.push(current);
        current = word;
      } else current = proposed;
    }
    lines.push(current);
  }
  return lines;
}

export function drawLayer(ctx: CanvasRenderingContext2D, layer: EditorLayer, images: Map<string, ImageBitmap>) {
  if (!layer.visible) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layer.x, layer.y, layer.width, layer.height);
  ctx.clip();
  if (layer.type === "image") {
    const image = images.get(layer.assetId);
    if (image) ctx.drawImage(image, layer.x, layer.y, layer.width, layer.height);
  } else if (layer.type === "shape") {
    ctx.fillStyle = layer.fill;
    if (layer.shape === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(layer.x + layer.width / 2, layer.y + layer.height / 2,
        layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(layer.x, layer.y, layer.width, layer.height);
  } else {
    ctx.fillStyle = layer.color;
    ctx.font = `${layer.fontSize}px Vazirmatn, Inter, "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    const rtl = /[\u0590-\u08FF]/.test(layer.text);
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = rtl ? "right" : "left";
    const inset = Math.min(12, Math.max(2, layer.width * .03));
    const lineHeight = layer.fontSize * 1.25;
    const lines = wrapText(ctx, layer.text, Math.max(1, layer.width - inset * 2));
    lines.forEach((line, index) => {
      const y = layer.y + inset + index * lineHeight;
      if (y + lineHeight <= layer.y + layer.height + 1) {
        ctx.fillText(line, rtl ? layer.x + layer.width - inset : layer.x + inset, y);
      }
    });
  }
  ctx.restore();
}

export function drawDocument(ctx: CanvasRenderingContext2D, document: EditorDocument,
  images: Map<string, ImageBitmap>, selectedId?: string | null) {
  ctx.clearRect(0, 0, document.width, document.height);
  for (const layer of document.layers) drawLayer(ctx, layer, images);
  const selected = document.layers.find(layer => layer.id === selectedId && layer.visible);
  if (!selected) return;
  const unit = Math.max(1, Math.max(document.width, document.height) / 760);
  ctx.save();
  ctx.strokeStyle = "#0c9ead";
  ctx.lineWidth = 2 * unit;
  ctx.setLineDash([5 * unit, 3 * unit]);
  ctx.strokeRect(selected.x, selected.y, selected.width, selected.height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#0c9ead";
  ctx.fillRect(selected.x + selected.width - 6 * unit, selected.y + selected.height - 6 * unit, 12 * unit, 12 * unit);
  ctx.strokeRect(selected.x + selected.width - 6 * unit, selected.y + selected.height - 6 * unit, 12 * unit, 12 * unit);
  ctx.restore();
}
