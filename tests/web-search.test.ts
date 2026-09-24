import assert from "node:assert/strict";
import test from "node:test";
import { answerWithWebSearch, extractWebSearchSources, WebSearchGroundingError } from "../src/server/chat/web-search";

test("web search sends the server tool, retains chat history, and returns provider citations", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  const result = await answerWithWebSearch({
    query: " What changed this week? ",
    history: [{ role: "user", content: "Tell me about launch dates" }],
    model: "openrouter/auto",
    apiKey: "test-secret",
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      authorization = new Headers(init?.headers).get("Authorization");
      return Response.json({ choices: [{ message: {
        role: "assistant",
        content: "The release was this week.",
        annotations: [{ type: "url_citation", url_citation: {
          url: "https://example.com/release", title: "Release notes", content: "excerpt"
        } }]
      } }] });
    }
  });

  assert.equal(authorization, "Bearer test-secret");
  assert.equal(requestBody?.model, "openrouter/auto");
  assert.equal(requestBody?.stream, false);
  assert.equal(requestBody?.max_tool_calls, 2);
  assert.deepEqual(requestBody?.tools, [{ type: "openrouter:web_search", parameters: {
    max_results: 5, max_total_results: 10, max_uses: 2, max_characters: 2000
  } }]);
  assert.deepEqual((requestBody?.messages as { role: string; content: string }[]).slice(-2), [
    { role: "user", content: "Tell me about launch dates" },
    { role: "user", content: "What changed this week?" }
  ]);
  assert.deepEqual(result, {
    answer: "The release was this week.",
    sources: [{ url: "https://example.com/release", title: "Release notes" }]
  });
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
});

test("citation extraction ignores unsafe URLs and unrelated annotations", () => {
  const sources = extractWebSearchSources([
    { type: "url_citation", url_citation: { url: "javascript:alert(1)", title: "Unsafe" } },
    { type: "url_citation", url_citation: { url: "https://user:password@example.com/x", title: "Unsafe" } },
    { type: "url_citation", url_citation: { url: "http://127.0.0.1:3000/private", title: "Unsafe" } },
    { type: "url_citation", url_citation: { url: "https://foo.local/test", title: "Unsafe" } },
    { type: "url_citation", url_citation: { url: "https://example.org/article", title: "\n Article\t title " } },
    { type: "url_citation", url_citation: { url: "https://example.org/article", title: "Duplicate" } },
    { type: "file_citation", url_citation: { url: "https://example.org/not-a-web-source" } },
    { type: "url_citation", url: "https://news.example.net/story", title: "Native format" }
  ]);
  assert.deepEqual(sources, [
    { url: "https://example.org/article", title: "Article title" },
    { url: "https://news.example.net/story", title: "Native format" }
  ]);
});

test("web search rejects an uncited answer, even if model prose contains a link", async () => {
  await assert.rejects(answerWithWebSearch({
    query: "Current result?", model: "openrouter/auto", apiKey: "test-secret",
    fetcher: async () => Response.json({ choices: [{ message: {
      content: "Found it at [Example](https://example.com/invented).", annotations: []
    } }] })
  }), WebSearchGroundingError);
});

test("web search hides provider error details and credentials", async () => {
  await assert.rejects(answerWithWebSearch({
    query: "Current result?", model: "openrouter/auto", apiKey: "test-secret",
    fetcher: async () => new Response("test-secret private provider payload", { status: 429 })
  }), (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal((error as Error).message, "OpenRouter rate limit reached.");
    assert.equal((error as Error).message.includes("test-secret"), false);
    return true;
  });
});
