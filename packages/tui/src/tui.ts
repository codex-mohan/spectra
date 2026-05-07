import { performance } from "node:perf_hooks";
import { isKeyRelease, matchesKey } from "./keys.js";
import type { Terminal } from "./terminal.js";
import { extractSegments, isImageLine, setCellDimensions, sliceByColumn, sliceWithWidth, visibleWidth } from "./utils.js";

// ---------------------------------------------------------------------------
// Component interface
// ---------------------------------------------------------------------------

export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}

export interface Focusable {
  focused: boolean;
}

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && "focused" in component;
}

export const CURSOR_MARKER = "\x1b_pi:c\x07";
export { visibleWidth };

// ---------------------------------------------------------------------------
// Overlay types
// ---------------------------------------------------------------------------

export type OverlayAnchor = "center"|"top-left"|"top-right"|"bottom-left"|"bottom-right"|"top-center"|"bottom-center"|"left-center"|"right-center";
export interface OverlayMargin { top?: number; right?: number; bottom?: number; left?: number }
export type SizeValue = number | `${number}%`;

export interface OverlayOptions {
  width?: SizeValue;
  minWidth?: number;
  maxHeight?: SizeValue;
  anchor?: OverlayAnchor;
  offsetX?: number;
  offsetY?: number;
  row?: SizeValue;
  col?: SizeValue;
  margin?: OverlayMargin | number;
  visible?: (termWidth: number, termHeight: number) => boolean;
  nonCapturing?: boolean;
}

export interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;
  unfocus(): void;
  isFocused(): boolean;
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export class Container implements Component {
  children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) this.children.splice(index, 1);
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) child.invalidate?.();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width));
    }
    return lines;
  }
}

// ---------------------------------------------------------------------------
// TUI
// ---------------------------------------------------------------------------

type InputListenerResult = { consume?: boolean; data?: string } | undefined;
type InputListener = (data: string) => InputListenerResult;

export class TUI extends Container {
  public terminal: Terminal;
  private previousLines: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private focusedComponent: Component | null = null;
  private inputListeners = new Set<InputListener>();
  public onDebug?: () => void;
  private renderRequested = false;
  private renderTimer: NodeJS.Timeout | undefined;
  private lastRenderAt = 0;
  private static readonly MIN_RENDER_INTERVAL_MS = 16;
  private cursorRow = 0;
  private hardwareCursorRow = 0;
  private showHardwareCursor = false;
  private clearOnShrink = true;
  private maxLinesRendered = 0;
  private previousViewportTop = 0;
  private fullRedrawCount = 0;
  private stopped = false;

  // Overlay stack
  private focusOrderCounter = 0;
  private overlayStack: {
    component: Component;
    options?: OverlayOptions;
    preFocus: Component | null;
    hidden: boolean;
    focusOrder: number;
  }[] = [];

  constructor(terminal: Terminal, showHardwareCursor?: boolean) {
    super();
    this.terminal = terminal;
    if (showHardwareCursor !== undefined) this.showHardwareCursor = showHardwareCursor;
  }

  get fullRedraws(): number { return this.fullRedrawCount; }

  getShowHardwareCursor(): boolean { return this.showHardwareCursor; }

  setShowHardwareCursor(enabled: boolean): void {
    if (this.showHardwareCursor === enabled) return;
    this.showHardwareCursor = enabled;
    if (!enabled) this.terminal.hideCursor();
    this.requestRender();
  }

  setClearOnShrink(enabled: boolean): void { this.clearOnShrink = enabled; }

  setFocus(component: Component | null): void {
    if (isFocusable(this.focusedComponent)) this.focusedComponent.focused = false;
    this.focusedComponent = component;
    if (isFocusable(component)) component.focused = true;
  }

  // --- Overlay API ---

  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
    const entry = {
      component, options,
      preFocus: this.focusedComponent,
      hidden: false,
      focusOrder: ++this.focusOrderCounter,
    };
    this.overlayStack.push(entry);
    if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
      this.setFocus(component);
    }
    this.terminal.hideCursor();
    this.requestRender();

    return {
      hide: () => {
        const index = this.overlayStack.indexOf(entry);
        if (index !== -1) {
          this.overlayStack.splice(index, 1);
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
          if (this.overlayStack.length === 0) this.terminal.hideCursor();
          this.requestRender();
        }
      },
      setHidden: (hidden: boolean) => {
        if (entry.hidden === hidden) return;
        entry.hidden = hidden;
        if (hidden) {
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
        } else {
          if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
            entry.focusOrder = ++this.focusOrderCounter;
            this.setFocus(component);
          }
        }
        this.requestRender();
      },
      isHidden: () => entry.hidden,
      focus: () => {
        if (!this.overlayStack.includes(entry) || !this.isOverlayVisible(entry)) return;
        if (this.focusedComponent !== component) this.setFocus(component);
        entry.focusOrder = ++this.focusOrderCounter;
        this.requestRender();
      },
      unfocus: () => {
        if (this.focusedComponent !== component) return;
        const topVisible = this.getTopmostVisibleOverlay();
        this.setFocus(topVisible && topVisible !== entry ? topVisible.component : entry.preFocus);
        this.requestRender();
      },
      isFocused: () => this.focusedComponent === component,
    };
  }

  hideOverlay(): void {
    const overlay = this.overlayStack.pop();
    if (!overlay) return;
    if (this.focusedComponent === overlay.component) {
      const topVisible = this.getTopmostVisibleOverlay();
      this.setFocus(topVisible?.component ?? overlay.preFocus);
    }
    if (this.overlayStack.length === 0) this.terminal.hideCursor();
    this.requestRender();
  }

  hasOverlay(): boolean {
    return this.overlayStack.some((o) => this.isOverlayVisible(o));
  }

  private isOverlayVisible(entry: (typeof this.overlayStack)[number]): boolean {
    if (entry.hidden) return false;
    if (entry.options?.visible) return entry.options.visible(this.terminal.columns, this.terminal.rows);
    return true;
  }

  private getTopmostVisibleOverlay(): (typeof this.overlayStack)[number] | undefined {
    for (let i = this.overlayStack.length - 1; i >= 0; i--) {
      if (this.overlayStack[i].options?.nonCapturing) continue;
      if (this.isOverlayVisible(this.overlayStack[i])) return this.overlayStack[i];
    }
    return undefined;
  }

  override invalidate(): void {
    super.invalidate();
    for (const overlay of this.overlayStack) overlay.component.invalidate?.();
  }

  // --- Lifecycle ---

  start(): void {
    this.stopped = false;
    this.terminal.start(
      (data) => this.handleInput(data),
      () => this.requestRender(),
    );
    this.terminal.hideCursor();
    this.requestRender();
  }

  addInputListener(listener: InputListener): () => void {
    this.inputListeners.add(listener);
    return () => { this.inputListeners.delete(listener); };
  }

  removeInputListener(listener: InputListener): void {
    this.inputListeners.delete(listener);
  }

  stop(): void {
    this.stopped = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    if (this.previousLines.length > 0) {
      const targetRow = this.previousLines.length;
      const lineDiff = targetRow - this.hardwareCursorRow;
      if (lineDiff > 0) this.terminal.write(`\x1b[${lineDiff}B`);
      else if (lineDiff < 0) this.terminal.write(`\x1b[${-lineDiff}A`);
      this.terminal.write("\r\n");
    }
    this.terminal.showCursor();
    this.terminal.stop();
  }

  // --- Render scheduling ---

  requestRender(force = false): void {
    if (force) {
      this.previousLines = [];
      this.previousWidth = -1;
      this.previousHeight = -1;
      this.cursorRow = 0;
      this.hardwareCursorRow = 0;
      this.maxLinesRendered = 0;
      this.previousViewportTop = 0;
      if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = undefined; }
      this.renderRequested = true;
      process.nextTick(() => {
        if (this.stopped || !this.renderRequested) return;
        this.renderRequested = false;
        this.lastRenderAt = performance.now();
        this.doRender();
      });
      return;
    }
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => this.scheduleRender());
  }

  private scheduleRender(): void {
    if (this.stopped || this.renderTimer || !this.renderRequested) return;
    const elapsed = performance.now() - this.lastRenderAt;
    const delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (this.stopped || !this.renderRequested) return;
      this.renderRequested = false;
      this.lastRenderAt = performance.now();
      this.doRender();
      if (this.renderRequested) this.scheduleRender();
    }, delay);
  }

  // --- Input handling ---

  private handleInput(data: string): void {
    if (this.inputListeners.size > 0) {
      let current = data;
      for (const listener of this.inputListeners) {
        const result = listener(current);
        if (result?.consume) return;
        if (result?.data !== undefined) current = result.data;
      }
      if (current.length === 0) return;
      data = current;
    }

    if (matchesKey(data, "shift+ctrl+d") && this.onDebug) {
      this.onDebug();
      return;
    }

    const focusedOverlay = this.overlayStack.find((o) => o.component === this.focusedComponent);
    if (focusedOverlay && !this.isOverlayVisible(focusedOverlay)) {
      const topVisible = this.getTopmostVisibleOverlay();
      if (topVisible) this.setFocus(topVisible.component);
      else this.setFocus(focusedOverlay.preFocus);
    }

    if (this.focusedComponent?.handleInput) {
      if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) return;
      this.focusedComponent.handleInput(data);
      this.requestRender();
    }
  }

  // --- Differential render ---

  private resolveOverlayLayout(options: OverlayOptions | undefined, overlayHeight: number, termWidth: number, termHeight: number): { width: number; row: number; col: number; maxHeight: number | undefined } {
    const opt = options ?? {};
    const margin = typeof opt.margin === "number" ? { top: opt.margin, right: opt.margin, bottom: opt.margin, left: opt.margin } : (opt.margin ?? {});
    const marginTop = Math.max(0, margin.top ?? 0);
    const marginRight = Math.max(0, margin.right ?? 0);
    const marginBottom = Math.max(0, margin.bottom ?? 0);
    const marginLeft = Math.max(0, margin.left ?? 0);
    const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
    const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

    let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
    if (opt.minWidth !== undefined) width = Math.max(width, opt.minWidth);
    width = Math.max(1, Math.min(width, availWidth));

    let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
    if (maxHeight !== undefined) maxHeight = Math.max(1, Math.min(maxHeight, availHeight));

    const effectiveHeight = maxHeight !== undefined ? Math.min(overlayHeight, maxHeight) : overlayHeight;

    let row: number;
    if (opt.row !== undefined) {
      row = typeof opt.row === "string" ? marginTop + Math.floor(Math.max(0, availHeight - effectiveHeight) * parseFloat(opt.row) / 100) : opt.row;
    } else {
      row = this.resolveAnchorRow(opt.anchor ?? "center", effectiveHeight, availHeight, marginTop);
    }

    let col: number;
    if (opt.col !== undefined) {
      col = typeof opt.col === "string" ? marginLeft + Math.floor(Math.max(0, availWidth - width) * parseFloat(opt.col) / 100) : opt.col;
    } else {
      col = this.resolveAnchorCol(opt.anchor ?? "center", width, availWidth, marginLeft);
    }

    if (opt.offsetY !== undefined) row += opt.offsetY;
    if (opt.offsetX !== undefined) col += opt.offsetX;
    row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - effectiveHeight));
    col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));

    return { width, row, col, maxHeight };
  }

  private resolveAnchorRow(anchor: OverlayAnchor, height: number, availHeight: number, marginTop: number): number {
    switch (anchor) {
      case "top-left": case "top-center": case "top-right": return marginTop;
      case "bottom-left": case "bottom-center": case "bottom-right": return marginTop + availHeight - height;
      default: return marginTop + Math.floor((availHeight - height) / 2);
    }
  }

  private resolveAnchorCol(anchor: OverlayAnchor, width: number, availWidth: number, marginLeft: number): number {
    switch (anchor) {
      case "top-left": case "left-center": case "bottom-left": return marginLeft;
      case "top-right": case "right-center": case "bottom-right": return marginLeft + availWidth - width;
      default: return marginLeft + Math.floor((availWidth - width) / 2);
    }
  }

  private compositeOverlays(lines: string[], termWidth: number, termHeight: number): string[] {
    if (this.overlayStack.length === 0) return lines;
    const result = [...lines];

    const rendered: { overlayLines: string[]; row: number; col: number; w: number }[] = [];
    let minLinesNeeded = result.length;

    const visibleEntries = this.overlayStack.filter((e) => this.isOverlayVisible(e));
    visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
    for (const entry of visibleEntries) {
      const { component, options } = entry;
      const { width, maxHeight } = this.resolveOverlayLayout(options, 0, termWidth, termHeight);
      let overlayLines = component.render(width);
      if (maxHeight !== undefined && overlayLines.length > maxHeight) {
        overlayLines = overlayLines.slice(0, maxHeight);
      }
      const { row, col } = this.resolveOverlayLayout(options, overlayLines.length, termWidth, termHeight);
      rendered.push({ overlayLines, row, col, w: width });
      minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
    }

    const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);
    while (result.length < workingHeight) result.push("");

    for (const { overlayLines, row, col, w } of rendered) {
      for (let i = 0; i < overlayLines.length; i++) {
        const idx = row + i;
        if (idx >= 0 && idx < result.length) {
          const truncatedOverlayLine = visibleWidth(overlayLines[i]) > w ? sliceByColumn(overlayLines[i], 0, w, true) : overlayLines[i];
          result[idx] = this.compositeLineAt(result[idx], truncatedOverlayLine, col, w, termWidth);
        }
      }
    }
    return result;
  }

  private static readonly SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

  private applyLineResets(lines: string[]): string[] {
    const reset = TUI.SEGMENT_RESET;
    for (let i = 0; i < lines.length; i++) {
      if (!isImageLine(lines[i])) lines[i] = lines[i] + reset;
    }
    return lines;
  }

  private compositeLineAt(baseLine: string, overlayLine: string, startCol: number, overlayWidth: number, totalWidth: number): string {
    if (isImageLine(baseLine)) return baseLine;

    const afterStart = startCol + overlayWidth;
    const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);
    const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);

    const beforePad = Math.max(0, startCol - base.beforeWidth);
    const overlayPad = Math.max(0, overlayWidth - overlay.width);
    const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
    const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
    const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
    const afterPad = Math.max(0, afterTarget - base.afterWidth);

    const r = TUI.SEGMENT_RESET;
    const result = base.before + " ".repeat(beforePad) + r + overlay.text + " ".repeat(overlayPad) + r + base.after + " ".repeat(afterPad);

    const resultWidth = visibleWidth(result);
    if (resultWidth <= totalWidth) return result;
    return sliceByColumn(result, 0, totalWidth, true);
  }

  private extractCursorPosition(lines: string[], height: number): { row: number; col: number } | null {
    const viewportTop = Math.max(0, lines.length - height);
    for (let row = lines.length - 1; row >= viewportTop; row--) {
      const line = lines[row];
      const markerIndex = line.indexOf(CURSOR_MARKER);
      if (markerIndex !== -1) {
        const col = visibleWidth(line.slice(0, markerIndex));
        lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
        return { row, col };
      }
    }
    return null;
  }

  private doRender(): void {
    if (this.stopped) return;
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
    const previousBufferLength = this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
    let prevViewportTop = heightChanged ? Math.max(0, previousBufferLength - height) : this.previousViewportTop;
    let hardwareCursorRow = this.hardwareCursorRow;

    const computeLineDiff = (targetRow: number): number => {
      const currentScreenRow = hardwareCursorRow - prevViewportTop;
      const targetScreenRow = targetRow - prevViewportTop;
      return targetScreenRow - currentScreenRow;
    };

    let newLines = this.render(width);

    if (this.overlayStack.length > 0) {
      newLines = this.compositeOverlays(newLines, width, height);
    }

    const cursorPos = this.extractCursorPosition(newLines, height);
    newLines = this.applyLineResets(newLines);

    const fullRender = (clear: boolean): void => {
      this.fullRedrawCount += 1;
      let buffer = "\x1b[?2026h";
      if (clear) buffer += "\x1b[2J\x1b[H\x1b[3J";
      for (let i = 0; i < newLines.length; i++) {
        if (i > 0) buffer += "\r\n";
        buffer += newLines[i];
      }
      buffer += "\x1b[?2026l";
      this.terminal.write(buffer);
      this.cursorRow = Math.max(0, newLines.length - 1);
      this.hardwareCursorRow = this.cursorRow;
      if (clear) this.maxLinesRendered = newLines.length;
      else this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
      this.previousViewportTop = Math.max(0, Math.max(height, newLines.length) - height);
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
    };

    if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
      fullRender(false);
      return;
    }

    if (widthChanged || heightChanged) {
      fullRender(true);
      return;
    }

    if (this.clearOnShrink && newLines.length < this.maxLinesRendered && this.overlayStack.length === 0) {
      fullRender(true);
      return;
    }

    // Find diff range
    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, this.previousLines.length);
    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
      const newLine = i < newLines.length ? newLines[i] : "";
      if (oldLine !== newLine) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }
    const appendedLines = newLines.length > this.previousLines.length;
    if (appendedLines) {
      if (firstChanged === -1) firstChanged = this.previousLines.length;
      lastChanged = newLines.length - 1;
    }
    const appendStart = appendedLines && firstChanged === this.previousLines.length && firstChanged > 0;

    if (firstChanged === -1) {
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousViewportTop = prevViewportTop;
      this.previousHeight = height;
      return;
    }

    if (firstChanged >= newLines.length) {
      if (this.previousLines.length > newLines.length) {
        let buffer = "\x1b[?2026h";
        const targetRow = Math.max(0, newLines.length - 1);
        if (targetRow < prevViewportTop) { fullRender(true); return; }
        const lineDiff = computeLineDiff(targetRow);
        if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
        else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
        buffer += "\r";
        const extraLines = this.previousLines.length - newLines.length;
        if (extraLines > height) { fullRender(true); return; }
        if (extraLines > 0) buffer += "\x1b[1B";
        for (let i = 0; i < extraLines; i++) {
          buffer += "\r\x1b[2K";
          if (i < extraLines - 1) buffer += "\x1b[1B";
        }
        if (extraLines > 0) buffer += `\x1b[${extraLines}A`;
        buffer += "\x1b[?2026l";
        this.terminal.write(buffer);
        this.cursorRow = targetRow;
        this.hardwareCursorRow = targetRow;
      }
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
      this.previousViewportTop = prevViewportTop;
      return;
    }

    if (firstChanged < prevViewportTop) { fullRender(true); return; }

    // Differential render
    let buffer = "\x1b[?2026h";
    const prevViewportBottom = prevViewportTop + height - 1;
    const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;
    if (moveTargetRow > prevViewportBottom) {
      const moveToBottom = height - 1 - Math.max(0, Math.min(height - 1, hardwareCursorRow - prevViewportTop));
      if (moveToBottom > 0) buffer += `\x1b[${moveToBottom}B`;
      const scroll = moveTargetRow - prevViewportBottom;
      buffer += "\r\n".repeat(scroll);
      prevViewportTop += scroll;
      hardwareCursorRow = moveTargetRow;
    }

    const lineDiff = computeLineDiff(moveTargetRow);
    if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
    else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;

    buffer += appendStart ? "\r\n" : "\r";

    const renderEnd = Math.min(lastChanged, newLines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i++) {
      if (i > firstChanged) buffer += "\r\n";
      buffer += "\x1b[2K";
      const line = newLines[i];
      if (!isImageLine(line) && visibleWidth(line) > width) {
        this.stop();
        throw new Error(`Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}). Use visibleWidth() and truncateToWidth() to truncate lines.`);
      }
      buffer += line;
    }

    let finalCursorRow = renderEnd;

    if (this.previousLines.length > newLines.length) {
      if (renderEnd < newLines.length - 1) {
        finalCursorRow = newLines.length - 1;
        buffer += `\x1b[${finalCursorRow - renderEnd}B`;
      }
      const extraLines = this.previousLines.length - newLines.length;
      for (let i = newLines.length; i < this.previousLines.length; i++) {
        buffer += "\r\n\x1b[2K";
      }
      buffer += `\x1b[${extraLines}A`;
    }

    buffer += "\x1b[?2026l";
    this.terminal.write(buffer);

    this.cursorRow = Math.max(0, newLines.length - 1);
    this.hardwareCursorRow = finalCursorRow;
    this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
    this.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);
    this.positionHardwareCursor(cursorPos, newLines.length);
    this.previousLines = newLines;
    this.previousWidth = width;
    this.previousHeight = height;
  }

  private positionHardwareCursor(cursorPos: { row: number; col: number } | null, totalLines: number): void {
    if (!cursorPos || totalLines <= 0) {
      this.terminal.hideCursor();
      return;
    }
    const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
    const targetCol = Math.max(0, cursorPos.col);
    const rowDelta = targetRow - this.hardwareCursorRow;
    let buf = "";
    if (rowDelta > 0) buf += `\x1b[${rowDelta}B`;
    else if (rowDelta < 0) buf += `\x1b[${-rowDelta}A`;
    buf += `\x1b[${targetCol + 1}G`;
    if (buf) this.terminal.write(buf);
    this.hardwareCursorRow = targetRow;
    if (this.showHardwareCursor) this.terminal.showCursor();
    else this.terminal.hideCursor();
  }
}

function parseSizeValue(value: SizeValue | undefined, referenceSize: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (match) return Math.floor((referenceSize * parseFloat(match[1])) / 100);
  return undefined;
}
