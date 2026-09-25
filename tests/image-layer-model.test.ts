import assert from "node:assert/strict";
import test from "node:test";
import { hitLayer, imageDocument, parseProject, reorderLayer, serializeProject, type EditorLayer } from "../src/app/image/editor/layer-model";

const imageId = "11111111-1111-4111-8111-111111111111";
const baseId = "22222222-2222-4222-8222-222222222222";
const upperId = "33333333-3333-4333-8333-333333333333";

test("source image creates a bounded canvas while preserving aspect ratio", () => {
  const document = imageDocument(imageId, "source.png", 4000, 2000, baseId);
  assert.equal(document.width, 2048);
  assert.equal(document.height, 1024);
  assert.equal(document.layers[0].width, document.width);
  assert.equal(document.layers[0].height, document.height);
});

test("layer serialization keeps editable order, text and geometry", () => {
  const document = imageDocument(imageId, "source.png", 1200, 900, baseId);
  const textLayer: EditorLayer = { type: "text", id: upperId, name: "Caption", text: "سلام world",
    color: "#123abc", fontSize: 48, x: 20, y: 40, width: 300, height: 100, visible: true };
  document.layers.push(textLayer);
  const restored = parseProject(JSON.parse(serializeProject(document)) as unknown);
  assert.deepEqual(restored, document);
  assert.equal(hitLayer(restored.layers, 25, 45), upperId);
  assert.equal(hitLayer(restored.layers, 1190, 890), baseId);
  assert.equal(hitLayer([{ ...textLayer, visible: false }], 25, 45), null);
  assert.deepEqual(reorderLayer(restored.layers, upperId, -1).map(layer => layer.id), [upperId, baseId]);
  assert.deepEqual(restored.layers.map(layer => layer.id), [baseId, upperId]);
});

test("project import rejects duplicate IDs, oversized canvas and dangerous image IDs", () => {
  const document = imageDocument(imageId, "source.png", 1000, 600, baseId);
  const duplicate = { ...document, layers: [document.layers[0], document.layers[0]] };
  assert.throws(() => parseProject(duplicate), /Invalid project layer/);
  assert.throws(() => parseProject({ ...document, width: 5000 }), /Invalid or unsupported/);
  assert.throws(() => parseProject({ ...document, layers: [{ ...document.layers[0], assetId: "../../secret" }] }), /Invalid project layer/);
  assert.throws(() => parseProject({ ...document, layers: Array(25).fill(document.layers[0]) }), /Invalid or unsupported/);
});
