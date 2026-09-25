import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemedSelect, selectChoices } from "../src/components/themed-select";

test("themed select renders the chosen option as an accessible combobox", () => {
  const markup = renderToStaticMarkup(createElement(ThemedSelect, {
    id: "model", value: "second", onValueChange: () => {},
    children: [createElement("option", { key: "first", value: "first" }, "First"),
      createElement("option", { key: "second", value: "second" }, "Second")]
  }));
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /id="model"/);
  assert.match(markup, />Second</);
  assert.doesNotMatch(markup, /<select/);
});

test("themed select parses disabled and numeric options", () => {
  const choices = selectChoices([
    createElement("option", { key: "a", value: 2 }, "Two"),
    createElement("option", { key: "b", value: "" , disabled: true }, "Choose")
  ]);
  assert.deepEqual(choices.map(choice => [choice.value, choice.searchText, choice.disabled]),
    [["2", "two", false], ["", "choose", true]]);
});
