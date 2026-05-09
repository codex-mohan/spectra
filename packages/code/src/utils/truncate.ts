export interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
  outputBytes: number;
  maxLines: number;
  maxBytes: number;
  truncatedBy: "lines" | "bytes";
  firstLineExceedsLimit: boolean;
  lastLinePartial: boolean;
}

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 51200;
export const GREP_MAX_LINE_LENGTH = 500;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function truncateHead(
  content: string,
  maxLines: number = DEFAULT_MAX_LINES,
  maxBytes: number = DEFAULT_MAX_BYTES,
): TruncationResult {
  const lines = content.split("\n");
  const totalLines = lines.length;

  const firstLineBytes = Buffer.byteLength(lines[0] ?? "", "utf-8");
  if (firstLineBytes > maxBytes) {
    const truncatedLine = lines[0].slice(0, maxBytes);
    return {
      content: truncatedLine,
      truncated: true,
      totalLines,
      outputLines: 1,
      outputBytes: firstLineBytes,
      maxLines,
      maxBytes,
      truncatedBy: "bytes",
      firstLineExceedsLimit: true,
      lastLinePartial: true,
    };
  }

  let outputLines = 0;
  let outputBytes = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineBytes = Buffer.byteLength(lines[i], "utf-8") + 1;
    if (outputLines >= maxLines || outputBytes + lineBytes > maxBytes) {
      break;
    }
    outputLines++;
    outputBytes += lineBytes;
  }

  const selectedLines = lines.slice(0, outputLines);
  const resultContent = selectedLines.join("\n");
  const truncated = outputLines < totalLines;
  const truncatedBy = outputLines >= maxLines ? "lines" : "bytes";

  return {
    content: resultContent,
    truncated,
    totalLines,
    outputLines,
    outputBytes: Buffer.byteLength(resultContent, "utf-8"),
    maxLines,
    maxBytes,
    truncatedBy: truncated ? truncatedBy : "lines",
    firstLineExceedsLimit: false,
    lastLinePartial: false,
  };
}

export function truncateTail(
  content: string,
  maxLines: number = DEFAULT_MAX_LINES,
  maxBytes: number = DEFAULT_MAX_BYTES,
): TruncationResult {
  const lines = content.split("\n");
  const totalLines = lines.length;

  let outputBytes = Buffer.byteLength(content, "utf-8");
  if (outputBytes <= maxBytes && totalLines <= maxLines) {
    return {
      content,
      truncated: false,
      totalLines,
      outputLines: totalLines,
      outputBytes,
      maxLines,
      maxBytes,
      truncatedBy: "lines",
      firstLineExceedsLimit: false,
      lastLinePartial: false,
    };
  }

  let endIdx = lines.length;
  let runningBytes = 0;
  while (endIdx > 0) {
    const lineBytes = Buffer.byteLength(lines[endIdx - 1], "utf-8") + 1;
    if (runningBytes + lineBytes > maxBytes || (lines.length - endIdx + 1) > maxLines) {
      break;
    }
    runningBytes += lineBytes;
    endIdx--;
  }

  const selectedLines = lines.slice(endIdx);
  const resultContent = selectedLines.join("\n");
  const outputLines = selectedLines.length;

  return {
    content: resultContent,
    truncated: true,
    totalLines,
    outputLines,
    outputBytes: Buffer.byteLength(resultContent, "utf-8"),
    maxLines,
    maxBytes,
    truncatedBy: outputLines >= maxLines ? "lines" : "bytes",
    firstLineExceedsLimit: false,
    lastLinePartial: false,
  };
}

export function truncateLine(line: string, maxLength: number = GREP_MAX_LINE_LENGTH): string {
  if (line.length <= maxLength) return line;
  return line.slice(0, maxLength) + `... (${line.length - maxLength} more chars)`;
}