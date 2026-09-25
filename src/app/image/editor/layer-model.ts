export type ImageLayer = {
  type: "image"; id: string; assetId: string; name: string;
  x: number; y: number; width: number; height: number; visible: boolean;
};
export type TextLayer = {
  type: "text"; id: string; name: string; text: string; color: string; fontSize: number;
  x: number; y: number; width: number; height: number; visible: boolean;
};
export type ShapeLayer = {
  type: "shape"; id: string; name: string; shape: "rectangle" | "ellipse"; fill: string;
  x: number; y: number; width: number; height: number; visible: boolean;
};
export type EditorLayer = ImageLayer | TextLayer | ShapeLayer;
export type EditorDocument = { version: 1; width: number; height: number; layers: EditorLayer[] };

export const MAX_LAYERS = 24;
export const MAX_CANVAS_EDGE = 2048;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const color = /^#[0-9a-f]{6}$/i;

export function imageDocument(assetId: string, name: string, originalWidth: number, originalHeight: number,
  layerId: string): EditorDocument {
  if (!uuid.test(assetId) || !uuid.test(layerId) || !Number.isFinite(originalWidth) || !Number.isFinite(originalHeight) ||
      originalWidth < 1 || originalHeight < 1) throw new Error("Invalid source image.");
  const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  return { version: 1, width, height, layers: [{ type: "image", id: layerId, assetId,
    name: name.slice(0, 100) || "Image", x: 0, y: 0, width, height, visible: true }] };
}

export function reorderLayer(layers: EditorLayer[], id: string, direction: -1 | 1): EditorLayer[] {
  const index = layers.findIndex(layer => layer.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= layers.length) return layers;
  const next = [...layers];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function hitLayer(layers: EditorLayer[], x: number, y: number): string | null {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];
    if (layer.visible && x >= layer.x && y >= layer.y && x <= layer.x + layer.width && y <= layer.y + layer.height) {
      return layer.id;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Imported projects are limited to owned asset IDs and plain canvas instructions. */
export function parseProject(value: unknown): EditorDocument {
  if (!isRecord(value) || value.version !== 1 || !Number.isInteger(value.width) ||
      !Number.isInteger(value.height) || !Array.isArray(value.layers) ||
      (value.width as number) < 1 || (value.height as number) < 1 ||
      (value.width as number) > MAX_CANVAS_EDGE || (value.height as number) > MAX_CANVAS_EDGE ||
      value.layers.length > MAX_LAYERS) throw new Error("Invalid or unsupported project file.");
  const layers: EditorLayer[] = [];
  const ids = new Set<string>();
  for (const item of value.layers) {
    if (!isRecord(item) || !uuid.test(String(item.id)) || ids.has(String(item.id)) ||
        typeof item.name !== "string" || item.name.length > 100 || typeof item.visible !== "boolean") {
      throw new Error("Invalid project layer.");
    }
    const geometry = [item.x, item.y, item.width, item.height];
    if (geometry.some(number => typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 8192) ||
        (item.width as number) < 1 || (item.height as number) < 1) throw new Error("Invalid project geometry.");
    const base = { id: item.id as string, name: item.name, visible: item.visible,
      x: item.x as number, y: item.y as number, width: item.width as number, height: item.height as number };
    if (item.type === "image" && typeof item.assetId === "string" && uuid.test(item.assetId)) {
      layers.push({ ...base, type: "image", assetId: item.assetId });
    } else if (item.type === "text" && typeof item.text === "string" && item.text.length <= 500 &&
        typeof item.color === "string" && color.test(item.color) &&
        typeof item.fontSize === "number" && Number.isFinite(item.fontSize) && item.fontSize >= 8 && item.fontSize <= 240) {
      layers.push({ ...base, type: "text", text: item.text, color: item.color, fontSize: item.fontSize });
    } else if (item.type === "shape" && (item.shape === "rectangle" || item.shape === "ellipse") &&
        typeof item.fill === "string" && color.test(item.fill)) {
      layers.push({ ...base, type: "shape", shape: item.shape, fill: item.fill });
    } else throw new Error("Invalid project layer.");
    ids.add(base.id);
  }
  return { version: 1, width: value.width as number, height: value.height as number, layers };
}

export function serializeProject(document: EditorDocument): string {
  return JSON.stringify(parseProject(document), null, 2);
}
