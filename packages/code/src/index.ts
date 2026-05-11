export { createBashTool, createReadTool, createEditTool, createWriteTool, createGrepTool, createFindTool, createLsTool, createAllTools } from "./tools/index.js";
export { truncateHead, truncateTail, formatSize, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES, GREP_MAX_LINE_LENGTH } from "./utils/truncate.js";
export type { TruncationResult } from "./utils/truncate.js";
export { resolvePath, resolveToCwd } from "./utils/path.js";
export { withFileMutationQueue } from "./utils/file-mutation-queue.js";
export { stripBom, detectLineEnding, normalizeToLF, restoreLineEndings, fuzzyFindText, applyEditsToNormalizedContent, generateDiffString } from "./utils/edit-diff.js";
export type { Edit } from "./utils/edit-diff.js";
export { getShellConfig, getShellEnv, killProcessTree, waitForChildProcess } from "./utils/shell.js";

export { EventBus, ExtensionApiImpl, ExtensionLoader } from "./extensions/index.js";
export type { Extension, ExtensionApi, ExtensionEventListener, ExtensionHook, ExtensionLogger, ExtensionLoaderLogger, ResolvedExtension } from "./extensions/index.js";

export { loadConfig, discoverConfigDir, resolveConfigPath, discoverContextFiles, mergeContextContents, buildSystemContext } from "./config/index.js";
export type { SpectraConfig, ContextConfig, SessionConfig, ContextFile } from "./config/index.js";

export type {
  BashOperations, BashToolDetails, BashToolOptions,
  ReadOperations, ReadToolDetails, ReadToolOptions,
  EditOperations, EditToolOptions, EditToolDetails,
  WriteOperations, WriteToolOptions,
  GrepOperations, GrepToolOptions, GrepToolDetails,
  FindOperations, FindToolOptions, FindToolDetails,
  LsToolDetails,
  WebFetchOperations, WebFetchToolDetails, WebFetchToolOptions,
} from "./types.js";