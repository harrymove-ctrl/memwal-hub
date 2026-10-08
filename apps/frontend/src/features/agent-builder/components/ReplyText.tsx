import type { ReactNode } from "react";

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "rule" }
  | { kind: "list"; ordered: boolean; items: string[] };

/** Bold (**text**) and inline code (`text`); single-asterisk emphasis markers are dropped. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=$|[\s).,;:!?])/g, "$1$2");
  });
}

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { kind: "list" }> | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[*\-•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        list = { kind: "list", ordered, items: [] };
        blocks.push(list);
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (!line.trim()) {
      flush();
      list = null;
      continue;
    }
    list = null;
    if (/^\s*(\*\*\*+|---+|___+)\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/**
 * Renders the small Markdown subset chat models commonly emit (paragraphs,
 * bullet and numbered lists, bold, inline code, rules, headings) as plain React
 * elements. No HTML from the model is ever interpreted.
 */
export function ReplyText({ text }: { text: string }) {
  return (
    <>
      {toBlocks(text).map((block, index) => {
        if (block.kind === "rule") return <hr key={index} />;
        if (block.kind === "heading") return <p key={index} className="dc-reply-heading"><strong>{inline(block.text)}</strong></p>;
        if (block.kind === "paragraph") return <p key={index}>{inline(block.text)}</p>;
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>);
        return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
      })}
    </>
  );
}
