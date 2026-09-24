export async function* streamOpenRouterText(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("The model returned an empty stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let complete = false;
  let totalCharacters = 0;

  function parseEvent(): string | null {
    if (dataLines.length === 0) return null;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") {
      complete = true;
      return null;
    }
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { throw new Error("The model returned an invalid stream."); }
    if (!payload || typeof payload !== "object") return null;
    if ("error" in payload) throw new Error("The model stream failed.");
    const choices = "choices" in payload ? payload.choices : undefined;
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
    const delta = "delta" in choices[0] ? choices[0].delta : undefined;
    if (!delta || typeof delta !== "object" || !("content" in delta)) return null;
    if (typeof delta.content === "string") return delta.content;
    if (Array.isArray(delta.content)) {
      return delta.content
        .filter((part: unknown): part is { type: "text"; text: string } =>
          !!part && typeof part === "object" && "type" in part && part.type === "text" &&
          "text" in part && typeof part.text === "string")
        .map((part: { text: string }) => part.text).join("");
    }
    return null;
  }

  try {
    while (!complete) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line === "") {
          const text = parseEvent();
          if (text) {
            totalCharacters += text.length;
            if (totalCharacters > 2_000_000) throw new Error("The model response is too large.");
            yield text;
          }
          if (complete) break;
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
        newline = buffer.indexOf("\n");
      }
      if (done) {
        if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
        const text = parseEvent();
        if (text) yield text;
        if (!complete) throw new Error("The model stream ended before completion.");
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
