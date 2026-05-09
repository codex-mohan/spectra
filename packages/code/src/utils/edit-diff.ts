export interface Edit {
  oldText: string;
  newText: string;
}

export interface DiffResult {
  diff: string;
  firstChangedLine: number;
}

export function stripBom(content: string): { bom: string; text: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: "\uFEFF", text: content.slice(1) };
  }
  return { bom: "", text: content };
}

export function detectLineEnding(content: string): string {
  const crlf = content.split("\r\n").length - 1;
  const lf = content.split("\n").length - 1 - crlf;
  if (crlf > 0 && crlf >= lf) return "\r\n";
  return "\n";
}

export function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function restoreLineEndings(content: string, lineEnding: string): string {
  if (lineEnding === "\r\n") {
    return content.replace(/\n/g, "\r\n");
  }
  return content;
}

export function fuzzyFindText(haystack: string, needle: string): number {
  const normalizedHaystack = normalizeUnicode(haystack);
  const normalizedNeedle = normalizeUnicode(needle);
  const idx = normalizedHaystack.indexOf(normalizedNeedle);
  if (idx >= 0) return idx;
  return -1;
}

function normalizeUnicode(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u00A0/g, " ");
}

export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  filePath: string,
): { baseContent: string; newContent: string } {
  const positions: { start: number; end: number; replaceText: string }[] = [];

  for (const edit of edits) {
    const idx = fuzzyFindText(normalizedContent, edit.oldText);
    if (idx === -1) {
      throw new Error(
        `Could not find the text to replace in ${filePath}. The exact text was not found. Make sure the oldText matches exactly (including whitespace and indentation).`,
      );
    }
    const afterIdx = idx + edit.oldText.length;
    const nextIdx = normalizedContent.indexOf(edit.oldText, idx + 1);
    if (nextIdx !== -1) {
      throw new Error(
        `Multiple matches found for the text to replace in ${filePath}. Provide more context to make the match unique, or use more specific oldText.`,
      );
    }
    positions.push({ start: idx, end: afterIdx, replaceText: edit.newText });
  }

  positions.sort((a, b) => a.start - b.start);
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].start < positions[i - 1].end) {
      throw new Error(
        `Overlapping edits in ${filePath}. Merge overlapping edits into a single edit.`,
      );
    }
  }

  const baseContent = normalizedContent;
  let newContent = normalizedContent;
  for (let i = positions.length - 1; i >= 0; i--) {
    const { start, end, replaceText } = positions[i];
    newContent = newContent.slice(0, start) + replaceText + newContent.slice(end);
  }

  return { baseContent, newContent };
}

export function generateDiffString(oldContent: string, newContent: string, filePath: string = "file"): DiffResult {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLines = Math.max(oldLines.length, newLines.length);
  let firstChangedLine = 1;
  const diffLines: string[] = [];

  let inChange = false;
  let changeStart = 1;

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine !== newLine) {
      if (!inChange) {
        changeStart = i + 1;
        inChange = true;
        if (firstChangedLine === 1) firstChangedLine = changeStart;
      }
      if (oldLine !== undefined) diffLines.push(`-${oldLine}`);
      if (newLine !== undefined) diffLines.push(`+${newLine}`);
    } else {
      if (inChange) {
        inChange = false;
      }
    }
  }

  const diff = diffLines.length > 0
    ? `--- ${filePath}\n+++ ${filePath}\n${diffLines.join("\n")}`
    : "";

  return { diff, firstChangedLine };
}