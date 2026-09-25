import assert from "node:assert/strict";
import { test } from "node:test";
import { templateFromPayload } from "../src/components/content-api";
import { localizeStarterTemplate } from "../src/components/starter-template-locale";
import { STARTER_TEMPLATES } from "../src/server/content/starter-templates";

test("Persian Explore localizes all untouched starter recipes without changing placeholders", () => {
  for (const [index, seed] of STARTER_TEMPLATES.entries()) {
    const template = templateFromPayload({ ...seed, id: `starter-${index}`, ownerId: "owner",
      visibility: "private" });
    assert.ok(template);
    const translated = localizeStarterTemplate(template, "fa");
    assert.notEqual(translated.title, template.title);
    assert.notEqual(translated.description, template.description);
    assert.notEqual(translated.definition.inputs[0].label, template.definition.inputs[0].label);
    assert.notEqual(translated.definition.steps[0].title, template.definition.steps[0].title);
    assert.notEqual(translated.definition.steps[0].prompt, template.definition.steps[0].prompt);
    assert.equal(translated.id, template.id);
    assert.equal(translated.ownerId, template.ownerId);
    assert.deepEqual(translated.definition.steps.map(step => step.prompt.match(/\{\{[^{}]+\}\}/g) ?? []),
      template.definition.steps.map(step => step.prompt.match(/\{\{[^{}]+\}\}/g) ?? []));
    assert.strictEqual(localizeStarterTemplate(template, "en"), template);
  }
});

test("customized and user-authored Explore content remains unchanged", () => {
  const seed = STARTER_TEMPLATES[0];
  const template = templateFromPayload({ ...seed, id: "custom", ownerId: "owner", visibility: "private" });
  assert.ok(template);
  const customized = { ...template, description: "My custom campaign" };
  assert.strictEqual(localizeStarterTemplate(customized, "fa"), customized);
  const changedStep = { ...template, definition: { ...template.definition, steps: [
    { ...template.definition.steps[0], prompt: "My own prompt {{product}}" },
    ...template.definition.steps.slice(1)
  ] } };
  assert.strictEqual(localizeStarterTemplate(changedStep, "fa"), changedStep);
});
