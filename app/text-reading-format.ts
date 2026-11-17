export type TextReadingFormat = "legacy" | "proofread-v1";

// Missing/unknown values retain the historical parser and its saved positions.
export function resolveTextReadingFormat(value: unknown): TextReadingFormat {
  return value === "proofread-v1" ? value : "legacy";
}

export function parseProofreadText(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").slice(2);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // Blank lines delimit paragraphs; a single line per paragraph is also supported.
  const hasSeparators = lines.some((line) => !line.trim());
  const blocks: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) blocks.push(buffer.join("\n"));
    buffer = [];
  };
  for (const line of lines) {
    if (!line.trim()) flush();
    else if (hasSeparators) buffer.push(line);
    else blocks.push(line);
  }
  flush();
  return blocks.map((text) => ({
    text,
    // Mark headings without rewriting their spelling or spacing.
    isHeading: /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|端書き|後記|[0-9０-９]+|[一二三四五六七八九十百千]+|第[0-9０-９一二三四五六七八九十百千]+[章話節編部])$/.test(text.trim()),
    preserveWhitespace: true,
  }));
}
