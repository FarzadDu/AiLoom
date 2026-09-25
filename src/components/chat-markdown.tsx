import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Keep model-supplied links navigable without allowing script or data URLs. */
export function safeChatUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch { return ""; }
}

/** Markdown is rendered as React nodes; raw model HTML and remote image embeds are disabled. */
export function ChatMarkdown({ text }: { text: string }) {
  return <div className="chat-markdown">
    <Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={safeChatUrl} components={{
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span>{alt ?? ""}</span>
    }}>{text}</Markdown>
  </div>;
}
