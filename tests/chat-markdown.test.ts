import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown, safeChatUrl } from "../src/components/chat-markdown";

test("chat replies render common Markdown and keep citations clickable", () => {
  const html = renderToStaticMarkup(createElement(ChatMarkdown, { text:
    "# Summary\n\n**Important** and `code`\n\n- first\n- second\n\n[source](https://example.org/paper)\n\n```js\nconst x = 1;\n```" }));
  assert.match(html, /<h1>Summary<\/h1>/);
  assert.match(html, /<strong>Important<\/strong>/);
  assert.match(html, /<ul>.*<li>first<\/li>.*<li>second<\/li>.*<\/ul>/s);
  assert.match(html, /<pre><code class="language-js">const x = 1;/);
  assert.match(html, /href="https:\/\/example\.org\/paper"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("chat Markdown never executes raw HTML or unsafe links", () => {
  const html = renderToStaticMarkup(createElement(ChatMarkdown, { text:
    "<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [good](https://example.org/) ![remote](https://tracker.example/pixel)" }));
  assert.doesNotMatch(html, /<script|<img|href="javascript:/i);
  assert.match(html, /href="https:\/\/example\.org\/"/);
  assert.equal(safeChatUrl("javascript:alert(1)"), "");
  assert.equal(safeChatUrl("data:text/html,hi"), "");
  assert.equal(safeChatUrl("https://example.org/a"), "https://example.org/a");
});
