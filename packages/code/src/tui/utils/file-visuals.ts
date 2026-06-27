import { c } from '../theme.js';
import { EXTENSION_TO_MIME } from './file-data.js';
export { MEDIA_SIZE_LIMITS, getSizeLimit, isSupportedMime } from './file-data.js';

export interface FileVisual {
	icon: string;
	label: string;
	color: string;
}

const EMOJI = {
	file: '📄',
	text: '📄',
	image: '🖼',
	audio: '🔊',
	video: '🎬',
	pdf: '📄',
	word: '📄',
	sheet: '📊',
	slide: '📊',
	archive: '📦',
	directory: '📁',
	typescript: '📘',
	javascript: '🟨',
	rust: '🦀',
	python: '🐍',
	go: '🐹',
	json: '🔧',
	markdown: '📝',
	html: '🌐',
	css: '🎨',
	shell: '⌨',
	docker: '🐳',
};

const NF = {
	file: '󰈙',
	text: '󰈙',
	image: '󰋩',
	audio: '󰝚',
	video: '󰕧',
	pdf: '󰈦',
	archive: '󰀼',
	word: '󰈬',
	sheet: '󰈛',
	slide: '󰈧',
	directory: '󰉋',
	typescript: '󰛦',
	javascript: '󰌞',
	rust: '󱘗',
	python: '󰌠',
	go: '󰟓',
	json: '󰘦',
	markdown: '󰍔',
	html: '󰌝',
	css: '󰌜',
	shell: '󰆍',
	docker: '󰡨',
};

const FALLBACK: FileVisual = { icon: NF.file, label: 'FILE', color: c.dim };

const MEDIA_BADGES: Record<string, FileVisual> = {
	'image/png': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'image/jpeg': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'image/gif': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'image/webp': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'image/avif': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'image/svg+xml': { icon: NF.image, label: 'SVG', color: c.fileImage },
	'application/pdf': { icon: NF.pdf, label: 'PDF', color: c.filePdf },
	'application/msword': { icon: NF.word, label: 'DOC', color: c.user },
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: NF.word, label: 'DOCX', color: c.user },
	'application/vnd.ms-excel': { icon: NF.sheet, label: 'XLS', color: c.success },
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: NF.sheet, label: 'XLSX', color: c.success },
	'application/vnd.ms-powerpoint': { icon: NF.slide, label: 'PPT', color: c.warn },
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': { icon: NF.slide, label: 'PPTX', color: c.warn },
	'application/x-directory': { icon: NF.directory, label: 'DIR', color: c.fileDirectory },
	'application/zip': { icon: NF.archive, label: 'ZIP', color: c.fileArchive },
	'application/x-tar': { icon: NF.archive, label: 'TAR', color: c.fileArchive },
	'application/gzip': { icon: NF.archive, label: 'GZ', color: c.fileArchive },
};

const MIME_PREFIX_BADGES: Record<string, FileVisual> = {
	'audio/': { icon: NF.audio, label: 'AUD', color: c.fileAudio },
	'video/': { icon: NF.video, label: 'VID', color: c.fileVideo },
	'image/': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'application/json': { icon: NF.json, label: 'JSON', color: c.langJson },
	'application/xml': { icon: NF.html, label: 'XML', color: c.langHtml },
};

const EXTENSION_VISUALS: Record<string, FileVisual> = {
	'.ts': { icon: NF.typescript, label: 'TS', color: c.langTypeScript },
	'.tsx': { icon: NF.typescript, label: 'TSX', color: c.langTypeScript },
	'.mts': { icon: NF.typescript, label: 'MTS', color: c.langTypeScript },
	'.cts': { icon: NF.typescript, label: 'CTS', color: c.langTypeScript },
	'.js': { icon: NF.javascript, label: 'JS', color: c.langJavaScript },
	'.jsx': { icon: NF.javascript, label: 'JSX', color: c.langJavaScript },
	'.mjs': { icon: NF.javascript, label: 'MJS', color: c.langJavaScript },
	'.cjs': { icon: NF.javascript, label: 'CJS', color: c.langJavaScript },
	'.rs': { icon: NF.rust, label: 'RS', color: c.langRust },
	'.py': { icon: NF.python, label: 'PY', color: c.langPython },
	'.pyi': { icon: NF.python, label: 'PYI', color: c.langPython },
	'.go': { icon: NF.go, label: 'GO', color: c.langGo },
	'.html': { icon: NF.html, label: 'HTML', color: c.langHtml },
	'.htm': { icon: NF.html, label: 'HTM', color: c.langHtml },
	'.css': { icon: NF.css, label: 'CSS', color: c.langCss },
	'.scss': { icon: NF.css, label: 'SCSS', color: c.langCss },
	'.less': { icon: NF.css, label: 'LESS', color: c.langCss },
	'.json': { icon: NF.json, label: 'JSON', color: c.langJson },
	'.yaml': { icon: NF.text, label: 'YAML', color: c.langYaml },
	'.yml': { icon: NF.text, label: 'YAML', color: c.langYaml },
	'.toml': { icon: NF.text, label: 'TOML', color: c.langToml },
	'.xml': { icon: NF.html, label: 'XML', color: c.langHtml },
	'.md': { icon: NF.markdown, label: 'MD', color: c.langMarkdown },
	'.mdx': { icon: NF.markdown, label: 'MDX', color: c.langMarkdown },
	'.txt': { icon: NF.text, label: 'TXT', color: c.fileText },
	'.csv': { icon: NF.text, label: 'CSV', color: c.fileData },
	'.sh': { icon: NF.shell, label: 'SH', color: c.langShell },
	'.bash': { icon: NF.shell, label: 'BASH', color: c.langShell },
	'.zsh': { icon: NF.shell, label: 'ZSH', color: c.langShell },
	'.ps1': { icon: NF.shell, label: 'PS1', color: c.langShell },
	'.bat': { icon: NF.shell, label: 'BAT', color: c.langShell },
	'.cmd': { icon: NF.shell, label: 'CMD', color: c.langShell },
	'.png': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'.jpg': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'.jpeg': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'.gif': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'.webp': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'.avif': { icon: NF.image, label: 'IMG', color: c.fileImage },
	'.svg': { icon: NF.image, label: 'SVG', color: c.fileImage },
	'.mp3': { icon: NF.audio, label: 'MP3', color: c.fileAudio },
	'.wav': { icon: NF.audio, label: 'WAV', color: c.fileAudio },
	'.ogg': { icon: NF.audio, label: 'OGG', color: c.fileAudio },
	'.flac': { icon: NF.audio, label: 'FLAC', color: c.fileAudio },
	'.aac': { icon: NF.audio, label: 'AAC', color: c.fileAudio },
	'.mp4': { icon: NF.video, label: 'MP4', color: c.fileVideo },
	'.webm': { icon: NF.video, label: 'WEBM', color: c.fileVideo },
	'.mov': { icon: NF.video, label: 'MOV', color: c.fileVideo },
	'.avi': { icon: NF.video, label: 'AVI', color: c.fileVideo },
	'.pdf': { icon: NF.pdf, label: 'PDF', color: c.filePdf },
	'.doc': { icon: NF.word, label: 'DOC', color: c.user },
	'.docx': { icon: NF.word, label: 'DOCX', color: c.user },
	'.xls': { icon: NF.sheet, label: 'XLS', color: c.success },
	'.xlsx': { icon: NF.sheet, label: 'XLSX', color: c.success },
	'.ppt': { icon: NF.slide, label: 'PPT', color: c.warn },
	'.pptx': { icon: NF.slide, label: 'PPTX', color: c.warn },
	'.zip': { icon: NF.archive, label: 'ZIP', color: c.fileArchive },
	'.tar': { icon: NF.archive, label: 'TAR', color: c.fileArchive },
	'.gz': { icon: NF.archive, label: 'GZ', color: c.fileArchive },
	'.tgz': { icon: NF.archive, label: 'TGZ', color: c.fileArchive },
	'.7z': { icon: NF.archive, label: '7Z', color: c.fileArchive },
	'.rar': { icon: NF.archive, label: 'RAR', color: c.fileArchive },
	dockerfile: { icon: NF.docker, label: 'DKR', color: c.langGo },
};

/**
 * Get the visual (icon, label, color) for a file based on its filename and MIME type.
 */
export function getFileVisual(input: { filename: string; mime: string }): FileVisual {
	const ext = getExtension(input.filename);
	if (ext) {
		const extVisual = EXTENSION_VISUALS[ext];
		if (extVisual) return extVisual;
	}
	const exactMime = MEDIA_BADGES[input.mime];
	if (exactMime) return exactMime;
	for (const [prefix, visual] of Object.entries(MIME_PREFIX_BADGES)) {
		if (input.mime.startsWith(prefix)) return visual;
	}
	const basename = input.filename.toLowerCase();
	if (EXTENSION_VISUALS[basename]) return EXTENSION_VISUALS[basename];
	if (input.mime.startsWith('text/')) return { icon: NF.text, label: 'TXT', color: c.fileText };
	return FALLBACK;
}

/**
 * Prefer Nerd Font glyphs. Set SPECTRA_NERD_FONT=0/false or NO_NERD_FONT=1
 * to force emoji fallback in terminals without Nerd Font coverage.
 */
export function hasNerdFont(): boolean {
	const forced = process.env.SPECTRA_NERD_FONT;
	if (forced != null) return forced !== '0' && forced.toLowerCase() !== 'false';
	return process.env.NO_NERD_FONT !== '1';
}

export function getDisplayIcon(input: { filename: string; mime: string }): string {
	return hasNerdFont() ? getFileVisual(input).icon : getFallbackIcon(input);
}

export function getFileIcon(filename: string): string {
	const ext = filename.lastIndexOf(".");
	const extStr = ext >= 0 ? filename.slice(ext).toLowerCase() : "";
	const mime = EXTENSION_TO_MIME[extStr] || "application/octet-stream";
	return getDisplayIcon({ filename, mime });
}

export function formatAttachmentBadge(input: { filename: string; mime: string }, options: { includeFilename?: boolean } = {}): string {
	const visual = getFileVisual(input);
	const head = `${getDisplayIcon(input)} ${visual.label}`;
	return options.includeFilename === false ? head : `${head} ${input.filename}`;
}

export function formatAttachmentMetadata(input: { metadata?: { sizeBytes?: number; width?: number; height?: number; durationMs?: number; files?: number } }): string {
	const m = input.metadata;
	if (!m) return '';
	const parts: string[] = [];
	if (m.width != null && m.height != null) parts.push(`${m.width}×${m.height}`);
	if (m.durationMs != null) parts.push(formatDuration(m.durationMs));
	if (m.files != null) parts.push(`${m.files} files`);
	if (m.sizeBytes != null) parts.push(formatSize(m.sizeBytes));
	return parts.join(' ');
}

/**
 * Get the badge text for display in prompt or message.
 */
export function getBadgeText(input: { filename: string; mime: string; metadata?: { sizeBytes?: number; width?: number; height?: number; durationMs?: number; files?: number } }): string {
	const meta = formatAttachmentMetadata(input);
	return meta ? `${formatAttachmentBadge(input)} ${meta}` : formatAttachmentBadge(input);
}

function getFallbackIcon(input: { filename: string; mime: string }): string {
	const ext = getExtension(input.filename);
	if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return EMOJI.typescript;
	if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return EMOJI.javascript;
	if (ext === '.rs') return EMOJI.rust;
	if (ext === '.py' || ext === '.pyi') return EMOJI.python;
	if (ext === '.go') return EMOJI.go;
	if (ext === '.md' || ext === '.mdx') return EMOJI.markdown;
	if (ext === '.html' || ext === '.htm') return EMOJI.html;
	if (ext === '.css' || ext === '.scss' || ext === '.less') return EMOJI.css;
	if (ext === '.json') return EMOJI.json;
	if (ext === '.sh' || ext === '.bash' || ext === '.zsh' || ext === '.ps1' || ext === '.bat' || ext === '.cmd') return EMOJI.shell;
	if (input.filename.toLowerCase() === 'dockerfile') return EMOJI.docker;
	if (input.mime === 'application/x-directory') return EMOJI.directory;
	if (input.mime === 'application/pdf') return EMOJI.pdf;
	if (ext === '.doc' || ext === '.docx') return EMOJI.word;
	if (ext === '.xls' || ext === '.xlsx') return EMOJI.sheet;
	if (ext === '.ppt' || ext === '.pptx') return EMOJI.slide;
	if (input.mime.startsWith('image/')) return EMOJI.image;
	if (input.mime.startsWith('audio/')) return EMOJI.audio;
	if (input.mime.startsWith('video/')) return EMOJI.video;
	if (input.mime === 'application/zip' || input.mime === 'application/x-tar' || input.mime === 'application/gzip') return EMOJI.archive;
	if (input.mime.startsWith('text/')) return EMOJI.text;
	return EMOJI.file;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getExtension(filename: string): string | undefined {
	const dot = filename.lastIndexOf('.');
	if (dot < 0) return undefined;
	return filename.slice(dot).toLowerCase();
}
