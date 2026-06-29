# Multimodal Input Support — Implementation Plan

## Overview

Enable users to attach files (images, audio, video, text, PDFs, directories) directly in the prompt input and send them as multimodal content to LLMs. Refer to OpenCode's implementation for the UX baseline — their prompt component uses extmarks (virtual text placeholders) and a MIME-typed badge system.

## Badge display in prompt input

Each attached file renders as an inline badge/pill in the prompt textarea using extmarks.
Badge format: `[Icon Label] filename` — two-segment pill with a colored icon segment + muted filename.
Icon/label per media type with distinct colors:

| Media Type | MIME Group | Badge Label | Icon | Color |
|------------|-----------|-------------|------|-------|
| Text files | `text/*` | `TXT` or language label | `T` / language icon | language-specific color |
| Images | `image/*` | `IMG` | 🖼 | `theme.fileImage` |
| PDFs | `application/pdf` | `PDF` | 📄 | `theme.filePdf` |
| Audio | `audio/*` | `AUD` / format label | 🔊 | `theme.fileAudio` |
| Video | `video/*` | `VID` / format label | 🎬 | `theme.fileVideo` |
| Directories | `application/x-directory` | `DIR` | 📁 | `theme.fileDirectory` |
| Archives | `application/zip` etc. | `ZIP` / format label | 📦 | `theme.fileArchive` |
| Other | fallback | `FILE` | 📄 | `theme.dim` |

### Language-specific text file colors

Text file badges use language-specific colors resolved from the file extension:

| Extension | Label | Icon | Color Token |
|-----------|-------|------|-------------|
| `.ts`, `.tsx` | `TS`, `TSX` | `TS`, `TX` | `langTypeScript` (blue) |
| `.js`, `.jsx` | `JS`, `JSX` | `JS`, `JX` | `langJavaScript` (yellow) |
| `.rs` | `RS` | `RS` | `langRust` (orange) |
| `.py` | `PY` | `PY` | `langPython` (yellow/warn) |
| `.go` | `GO` | `GO` | `langGo` (= accent, teal) |
| `.json` | `JSON` | `{ }` | `langJson` (green) |
| `.md` | `MD` | `M↓` | `langMarkdown` (muted) |
| `.html` | `HTML` | `< >` | `langHtml` (orange) |
| `.css`, `.scss` | `CSS` | `{ }` | `langCss` (blue) |
| `.sh`, `.bash` | `SH` | `$_` | `langShell` (green) |
| `.yaml`, `.yml` | `YAML` | `---` | `langYaml` (muted) |
| `.toml` | `TOML` | `---` | `langToml` (orange) |

### Theme-friendly color design

- Colors are defined as semantic tokens in `theme.ts` (`fileImage`, `fileAudio`, `langTypeScript`, etc.)
- Where a language color naturally matches an existing base token, it references that token:
  - `langTypeScript` → `c.user` (blue)
  - `langPython` → `c.warn` (yellow)
  - `langGo` → `c.accent` (teal)
  - `langJson` → `c.success` (green)
- New tokens are added only where no natural match exists (`langRust`, `filePdf`, `fileArchive`)
- A future theme system can override all tokens without touching attachment logic
- All visual resolution goes through a single `getFileVisual()` function in `file-visuals.ts`

## Supported MIME types

- Images: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/svg+xml`
- Audio: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/flac`, `audio/aac`
- Video: `video/mp4`, `video/webm`, `video/quicktime`
- Documents: `application/pdf`, `text/plain`, `text/markdown`, `text/csv`, `text/html`, `text/css`, `text/javascript`, `text/typescript`, `application/json`, `application/xml`
- Directories: `application/x-directory`
- Archives: `application/zip`, `application/x-tar`, `application/gzip`

## Attachment methods

- [x] Paste file path — detect pasted file paths, read content based on MIME extension mapping
- [x] Clipboard image paste — read system clipboard for image data (cross-platform: macOS/Linux/Windows)
- [x] `@` fuzzy search — type `@` to trigger autocomplete, fuzzy-search files by path, select one
- [ ] Clipboard audio/video paste — read clipboard for media file references where supported (deferred)

## Architecture

```
┌──────────────────┐
│   Prompt Input    │
│  (PromptBar)      │
│                   │
│  ┌──────────────┐ │
│  │ Attachments  │ │  ← @ autocomplete, paste, clipboard
│  │ State +      │ │
│  │ Extmark      │ │
│  │ Badges       │ │
│  └──────┬───────┘ │
└─────────┼─────────┘
          │
          ▼
┌──────────────────┐
│ PromptSubmitPayload│
│ { text,           │
│   attachments[] } │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────────┐
│ Session│ │ Provider     │
│ Store  │ │ Serializers  │
│ (SQLite)│ │ (Anthropic,  │
│        │ │  OpenAI, etc.)│
└────────┘ └──────────────┘
```

## Implementation Phases

### Phase 1: Core types and visuals

**Files:**
- `packages/ai/src/types.ts`
- `packages/ai/src/index.ts`
- `packages/code/src/tui/theme.ts`
- `packages/code/src/tui/utils/file-data.ts` (new)
- `packages/code/src/tui/utils/file-visuals.ts` (new)

**Changes:**
- Add `FileContent` interface to SDK types:
  ```ts
  export interface FileContent {
    type: 'file';
    mime: string;
    filename: string;
    url: string; // data URL or file:// URL for directories
    source?: {
      type: 'file' | 'clipboard' | 'directory';
      path?: string;
      text?: { start: number; end: number; value: string };
    };
    metadata?: {
      sizeBytes?: number;
      width?: number;
      height?: number;
      durationMs?: number;
      files?: number;
    };
  }
  ```
- Update `UserMessage.content` to `string | (TextContent | ImageContent | FileContent)[]`
- Update `ToolResultMessage.content` to `(TextContent | ImageContent | FileContent)[]`
- Export `FileContent` from `@mohanscodex/spectra-ai`
- Add semantic theme tokens to `theme.ts`:
  - File type colors: `fileText`, `fileImage`, `filePdf`, `fileAudio`, `fileVideo`, `fileDirectory`, `fileArchive`, `fileData`
  - Language colors: `langTypeScript`, `langJavaScript`, `langRust`, `langPython`, `langGo`, `langJson`, `langMarkdown`, `langHtml`, `langCss`, `langShell`, `langYaml`, `langToml`
  - Reuse existing base tokens where natural (e.g. `langTypeScript = c.user`, `langPython = c.warn`)
- Split `file-data.ts` (pure MIME maps, size limits, no theme dependency) from `file-visuals.ts` (theme-dependent icon/label/color resolver)
- `getFileVisual(input: { filename, mime })` returns `{ icon, label, color }`

### Phase 2: Local attachment reader

**New file:** `packages/code/src/tui/utils/local-attachment.ts`

**Implement:**
- Extension → MIME map for all supported types
- `detectMime(filePath)` — resolve MIME from extension
- `readLocalAttachment(filePath)` — read file, create data URL, return `FileContent`
- `readDirectoryAttachment(dirPath)` — recursively walk directory, skip ignored dirs (`.git`, `node_modules`, `dist`, `build`, `target`, `.next`, `__pycache__`, `.venv`, `vendor`), cap at 200 files / 4 levels deep, produce tree summary
- `readClipboardAttachment()` — platform-specific clipboard image extraction:
  - macOS: `osascript` clipboard PNG
  - Windows: PowerShell `System.Windows.Forms.Clipboard.GetImage()`
  - Linux: `wl-paste` then `xclip`
- `resolvePastedFilePath(value, platform)` — parse pasted string as file path (Windows/POSIX/file:// URLs)
- `formatFileSize(bytes)` — human-readable size
- PNG dimension reading (header parse: IHDR chunk)
- JPEG dimension reading (SOF marker scan)
- Size limits per media type:
  - Images: 20MB
  - Audio: 25MB
  - Video: 50MB
  - Documents: 10MB

### Phase 3: Prompt attachments + extmark badges

**File:** `packages/code/src/tui/prompt-bar.tsx`

**Changes:**
- Add types:
  ```ts
  export interface PromptAttachment extends FileContent {
    badge: { icon: string; label: string; color: string };
  }

  export interface PromptSubmitPayload {
    text: string;
    attachments: PromptAttachment[];
  }

  export interface PromptBarRef {
    addAttachment(file: FileContent): void;
    getAttachments(): PromptAttachment[];
    clearAttachments(): void;
  }
  ```
- Change `onSubmit` prop to accept `PromptSubmitPayload`
- Add `onGetPromptBar` prop to expose `PromptBarRef` to parent
- Maintain `attachments[]` state
- On paste:
  - if pasted text is a local path or `file://`, read as attachment
  - if pasted text is empty, try clipboard image extraction
  - otherwise insert text normally
- Render attachment badges above textarea with remove button (✕)
- Allow submit when text is empty but attachments exist
- Badge rendering uses `getFileVisual()` for consistent colors

### Phase 4: `@` fuzzy file autocomplete

**New file:** `packages/code/src/tui/components/file-autocomplete.tsx`

**Changes in:**
- `packages/code/src/tui/app.tsx`
- `packages/code/src/tui/hooks/use-app-keyboard.ts` (if needed)

**Implement:**
- Trigger when current token starts with `@`
- Use `rg --files` (ripgrep) for fast project file listing
- Fuzzy-match by filename and path
- Rank: exact basename > starts-with > contains > by name length
- UI: floating menu above prompt, same pattern as `SlashAutocomplete`
- Tab/Enter selects → reads file as attachment, adds to prompt
- Directory entries show 📁 icon; selecting a directory attaches it
- Display file visual icon + colored label + path per result

### Phase 5: Submit and session persistence

**Files:**
- `packages/code/src/tui/hooks/use-chat-submit.ts`
- `packages/code/src/tui/types.ts`
- `packages/code/src/tui/components/message.tsx`
- `packages/code/src/tui/utils/session-messages.ts`

**Changes:**
- `handleSubmit` accepts `PromptSubmitPayload`
- Slash commands only run when no attachments present
- SDK user message built as array:
  ```ts
  [
    ...(text ? [{ type: 'text', text }] : []),
    ...attachments.map(toFileContent)
  ]
  ```
- `ChatMessage` extended with `attachments?: PromptAttachment[]`
- `sdkMessagesToChatMessages` extracts `FileContent`/`ImageContent` from stored user messages into `attachments`
- User message display renders attachment badges with `getFileVisual()` colors

### Phase 6: Provider capabilities and serialization

**Files:**
- `packages/ai/src/registry.ts`
- `packages/ai/src/providers/anthropic.ts`
- `packages/ai/src/providers/openai-completions.ts`
- `packages/ai/src/providers/openai-responses.ts`
- `packages/code/src/services/custom-providers.ts`

**Changes:**
- Add `supportedMediaTypes?: string[]` to `Provider` interface
- Anthropic:
  - images → `{ type: 'image', source: { type: 'base64', media_type, data } }`
  - PDFs → `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }`
  - text files → inline as `{ type: 'text', text: '[filename]\ncontent' }`
  - unsupported → warning text
  - SDK type limitation: cast content as `unknown as MessageParam['content']` for document blocks
- OpenAI Chat Completions:
  - images → `{ type: 'image_url', image_url: { url: dataUrl } }`
  - text files → inline as text
  - unsupported → warning text
- OpenAI Responses:
  - images → `{ type: 'input_image', image_url: dataUrl }`
  - text files → inline as `{ type: 'input_text', text }`
  - unsupported → warning text
- Custom providers:
  - images → `image_url` format
  - text files → inline
- `supportedMediaTypes` arrays on each provider

### Phase 7: Tests

**New file:** `packages/code/src/__tests__/local-attachment.test.ts`

**43 tests covering:**
- MIME detection (24 cases: PNG, JPEG, PDF, TypeScript, Python, Rust, shell, etc.)
- Path resolution (12 cases: Windows, POSIX, file:// URLs, quote stripping, URL rejection)
- File size formatting (6 cases: bytes, KB, MB, zero)

**Note:** `file-visuals.ts` tests require OpenTUI runtime (theme dependency) — visual resolution is covered by integration through the prompt bar and message components.

## Provider media capability matrix

| Provider | Images | PDFs | Audio | Video | Text Files |
|----------|--------|------|-------|-------|------------|
| Anthropic | ✅ | ✅ | ⚠️ degrade | ⚠️ degrade | ✅ inline |
| OpenAI Completions | ✅ | ⚠️ degrade | ⚠️ degrade | ⚠️ degrade | ✅ inline |
| OpenAI Responses | ✅ | ⚠️ degrade | ⚠️ degrade | ⚠️ degrade | ✅ inline |
| Custom providers | ✅ | ⚠️ degrade | ⚠️ degrade | ⚠️ degrade | ✅ inline |

⚠️ degrade = unsupported types convert to warning text in the message

## OpenCode reference files used

- `packages/tui/src/component/prompt/index.tsx` — extmark creation, paste handling, submission, store/restore
- `packages/tui/src/component/prompt/autocomplete.tsx` — `@` file search, `createFilePart()`, fuzzy ranking
- `packages/tui/src/component/prompt/local-attachment.ts` — MIME detection by extension
- `packages/tui/src/clipboard.ts` — platform-specific clipboard image extraction (macOS/Win/Linux)
- `packages/tui/src/context/clipboard.tsx` — ClipboardService interface
- `packages/tui/src/routes/session/index.tsx` — `MIME_BADGE` map + badge rendering
- `packages/tui/src/theme/index.ts` — extmark style definitions
