/** Strips the leading `---\n...\n---` front-matter block a skill file carries. */
export function bodyWithoutFrontMatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export interface SkillSection {
  title: string;
  /** First paragraph under the heading, trimmed to a preview length. */
  preview: string;
}

const H2_HEADING = /^##\s+(.+)$/gm;

/**
 * The skill's own `##` sections, each with its opening paragraph — a real
 * walkthrough of what the file actually says, not a summary invented for
 * display. Used as the left panel's step list on the skill graph page.
 */
export function skillSections(source: string): SkillSection[] {
  const body = bodyWithoutFrontMatter(source);
  const headings = [...body.matchAll(H2_HEADING)];
  const sections: SkillSection[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const start = heading.index! + heading[0].length;
    const end = headings[i + 1]?.index ?? body.length;
    const sectionBody = body.slice(start, end).trim();
    const firstBlock = sectionBody
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .find((block) => block.length > 0 && !/^[-*\d`|#]/.test(block));

    sections.push({
      title: heading[1]!.replace(/[`[\]]/g, "").trim(),
      preview: (firstBlock ?? "").replace(/\s+/g, " "),
    });
  }

  return sections;
}
