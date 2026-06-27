import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { FileContent } from '@mohanscodex/spectra-ai';
import { EXTENSION_TO_MIME, getSizeLimit } from './file-data.js';

/**
 * Detect MIME type from file extension.
 */
export function detectMime(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	return EXTENSION_TO_MIME[ext] ?? 'application/octet-stream';
}

/**
 * Parse a pasted string as a local file path, handling Windows and POSIX paths.
 * Returns null if the string doesn't look like a file path.
 */
export function resolvePastedFilePath(value: string, platform: string): string | null {
	const raw = value.replace(/^['"]+|['"]+$/g, '');
	if (raw.startsWith('file://')) {
		try {
			const url = new URL(raw);
			return decodeURIComponent(url.pathname.replace(/^\/([A-Z]:)/i, '$1'));
		} catch {
			return null;
		}
	}
	// Skip URLs
	if (/^(https?|ftp):\/\//i.test(raw)) return null;
	// Skip if it has too many spaces (probably a sentence, not a path)
	if (raw.split(/\s/).length > 3) return null;
	// Must look like a path
	if (platform === 'win32') {
		if (/^[A-Za-z]:\\/.test(raw) || raw.startsWith('\\\\')) return raw;
	} else {
		if (raw.startsWith('/')) return raw;
	}
	return null;
}

/**
 * Read a local file as an attachment. Returns a FileContent object suitable
 * for the SDK, or a text content if the file is a text-based type.
 */
export async function readLocalAttachment(filePath: string, options?: { textRange?: { start: number; end: number } }): Promise<FileContent | null> {
	try {
		const resolved = resolve(filePath);
		const fileStat = await stat(resolved);
		const filename = basename(resolved);
		const mime = detectMime(resolved);

		if (fileStat.isDirectory()) {
			return readDirectoryAttachment(resolved, filename);
		}

		const limit = getSizeLimit(mime);
		if (limit && fileStat.size > limit) {
			return null; // exceeded size limit
		}

		const buffer = await readFile(resolved);
		const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
		if (options?.textRange && (mime.startsWith('text/') || TEXT_MIMES.has(mime))) {
			const text = buffer.toString('utf-8');
			const lines = text.split(/\r?\n/);
			const selected = lines.slice(options.textRange.start - 1, options.textRange.end).join('\n');
			return {
				type: 'file',
				mime,
				filename,
				url: `data:${mime};base64,${Buffer.from(selected).toString('base64')}`,
				source: {
					type: 'file',
					path: resolved,
					text: { start: options.textRange.start, end: options.textRange.end, value: selected },
				},
				metadata: { sizeBytes: Buffer.byteLength(selected) },
			};
		}
		const metadata: FileContent['metadata'] = { sizeBytes: fileStat.size };

		// Try to extract image dimensions for PNG/JPEG
		if (mime === 'image/png') {
			const dims = readPngDimensions(buffer);
			if (dims) {
				metadata.width = dims.width;
				metadata.height = dims.height;
			}
		} else if (mime === 'image/jpeg') {
			const dims = readJpegDimensions(buffer);
			if (dims) {
				metadata.width = dims.width;
				metadata.height = dims.height;
			}
		}

		return {
			type: 'file',
			mime,
			filename,
			url: dataUrl,
			source: { type: 'file', path: resolved },
			metadata,
		};
	} catch {
		return null;
	}
}

/**
 * Read a directory as an attachment: recursively walk files, skip ignored dirs,
 * produce a tree summary + selected file excerpts.
 */
export async function readDirectoryAttachment(
	dirPath: string,
	dirname: string,
): Promise<FileContent> {
	const MAX_FILES = 200;
	const MAX_DEPTH = 4;
	const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.next', '__pycache__', '.venv', 'vendor']);
	const IGNORED_EXTS = new Set(['.exe', '.dll', '.so', '.dylib', '.o', '.a', '.pyc', '.wasm']);

	const entries: Array<{ path: string; name: string; isDir: boolean }> = [];
	await walkDirectory(dirPath, '', entries, IGNORED_DIRS, IGNORED_EXTS, MAX_FILES, MAX_DEPTH);

	const treeLines = entries.map((e) => `${e.isDir ? '[D] ' : '    '}${e.path}`);
	const content = `Directory: ${dirname}\nFiles (${entries.length}):\n${treeLines.join('\n')}`;
	const dataUrl = `data:text/plain;base64,${Buffer.from(content).toString('base64')}`;

	return {
		type: 'file',
		mime: 'application/x-directory',
		filename: dirname,
		url: dataUrl,
		source: { type: 'directory', path: dirPath },
		metadata: { files: entries.length },
	};
}

/**
 * Read clipboard content as an attachment.
 * Uses platform-specific commands to extract images.
 */
export async function readClipboardAttachment(): Promise<FileContent | null> {
	const fileRef = await readClipboardFileReference(process.platform);
	if (fileRef) {
		const attachment = await readLocalAttachment(fileRef);
		if (attachment) return attachment;
	}

	const platform = process.platform;
	if (platform === 'darwin') return readClipboardMacOS();
	if (platform === 'win32') return readClipboardWindows();
	if (platform === 'linux') return readClipboardLinux();
	return null;
}

export function readPastedBytesAttachment(bytes: Uint8Array): FileContent | null {
	const buffer = Buffer.from(bytes);
	const mime = detectImageMime(buffer);
	if (!mime) return null;
	const metadata: FileContent['metadata'] = { sizeBytes: buffer.length };
	const dims = mime === 'image/png' ? readPngDimensions(buffer) : mime === 'image/jpeg' ? readJpegDimensions(buffer) : null;
	if (dims) {
		metadata.width = dims.width;
		metadata.height = dims.height;
	}
	return {
		type: 'file',
		mime,
		filename: `clipboard.${mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1]}`,
		url: `data:${mime};base64,${buffer.toString('base64')}`,
		source: { type: 'clipboard' },
		metadata,
	};
}


/**
 * Format a file size in human-readable form.
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Internal helpers ──

const TEXT_MIMES = new Set([
	'application/json',
	'application/xml',
	'application/javascript',
	'application/typescript',
	'application/x-javascript',
	'application/x-typescript',
]);

async function walkDirectory(
	base: string,
	rel: string,
	entries: Array<{ path: string; name: string; isDir: boolean }>,
	ignored: Set<string>,
	ignoredExts: Set<string>,
	maxFiles: number,
	maxDepth: number,
	depth = 0,
): Promise<void> {
	if (entries.length >= maxFiles || depth >= maxDepth) return;

	let items: string[];
	try {
		items = await readdir(base);
	} catch {
		return;
	}

	for (const name of items) {
		if (entries.length >= maxFiles) return;
		if (name.startsWith('.') && name !== '.env') continue;
		if (ignored.has(name)) continue;

		const fullPath = join(base, name);
		const relPath = rel ? `${rel}/${name}` : name;

		let isDir: boolean;
		try {
			const s = await stat(fullPath);
			isDir = s.isDirectory();
		} catch {
			continue;
		}

		if (isDir) {
			entries.push({ path: `${relPath}/`, name, isDir: true });
			await walkDirectory(fullPath, relPath, entries, ignored, ignoredExts, maxFiles, maxDepth, depth + 1);
		} else {
			const ext = extname(name).toLowerCase();
			if (ignoredExts.has(ext)) continue;
			entries.push({ path: relPath, name, isDir: false });
		}
	}
}

// ── Image dimension readers ──

function detectImageMime(buffer: Buffer): string | null {
	if (buffer.length >= 8
		&& buffer[0] === 0x89
		&& buffer[1] === 0x50
		&& buffer[2] === 0x4e
		&& buffer[3] === 0x47) return 'image/png';
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
	if (buffer.length >= 12
		&& buffer.toString('ascii', 0, 4) === 'RIFF'
		&& buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
	if (buffer.length >= 6) {
		const sig = buffer.toString('ascii', 0, 6);
		if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
	}
	return null;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
	// PNG header: 8-byte signature, then IHDR chunk (width at offset 16, height at offset 20, big-endian u32)
	if (buffer.length < 24) return null;
	if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null;
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	if (width === 0 || height === 0 || width > 65535 || height > 65535) return null;
	return { width, height };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
	// JPEG: start with FF D8, scan for SOF markers (FF C0..CF except FF C4, C8, CC)
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

	let offset = 2;
	while (offset + 4 < buffer.length) {
		if (buffer[offset] !== 0xff) { offset++; continue; }
		const marker = buffer[offset + 1];
		if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			if (offset + 9 < buffer.length) {
				const height = buffer.readUInt16BE(offset + 5);
				const width = buffer.readUInt16BE(offset + 7);
				if (width > 0 && height > 0) return { width, height };
			}
		}
		if (offset + 3 < buffer.length) {
			const len = buffer.readUInt16BE(offset + 2);
			offset += 2 + len;
		} else {
			break;
		}
	}
	return null;
}

// ── Platform clipboard readers ──

async function readClipboardFileReference(platform: NodeJS.Platform): Promise<string | null> {
	if (platform === 'win32') return readClipboardWindowsFile();
	if (platform === 'darwin') return readClipboardMacOSFile();
	if (platform === 'linux') return readClipboardLinuxFile();
	return null;
}

async function readClipboardWindowsFile(): Promise<string | null> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execFileAsync = promisify(execFile);
	const script = [
		'Add-Type -AssemblyName System.Windows.Forms',
		'$files = [System.Windows.Forms.Clipboard]::GetFileDropList()',
		'if ($files -and $files.Count -gt 0) { $files[0] }',
	].join('; ');
	try {
		const { stdout } = await execFileAsync('powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', script], { timeout: 3000 });
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

async function readClipboardMacOSFile(): Promise<string | null> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execFileAsync = promisify(execFile);
	try {
		const { stdout } = await execFileAsync('osascript', [
			'-e', 'try',
			'-e', 'POSIX path of (the clipboard as alias)',
			'-e', 'on error',
			'-e', 'return ""',
			'-e', 'end try',
		], { timeout: 3000 });
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

async function readClipboardLinuxFile(): Promise<string | null> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execFileAsync = promisify(execFile);
	for (const cmd of [
		{ name: 'wl-paste', args: ['-t', 'text/uri-list'] },
		{ name: 'xclip', args: ['-selection', 'clipboard', '-t', 'text/uri-list', '-o'] },
	]) {
		try {
			const { stdout } = await execFileAsync(cmd.name, cmd.args, { timeout: 3000 });
			const first = stdout.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
			if (!first) continue;
			if (first.startsWith('file://')) return decodeURIComponent(new URL(first).pathname);
			return first;
		} catch {
			// Try the next clipboard backend.
		}
	}
	return null;
}

async function readClipboardMacOS(): Promise<FileContent | null> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execFileAsync = promisify(execFile);
	const osTmp = (await import('node:os')).tmpdir();
	const tmpPath = join(osTmp, 'spectra-clipboard.png');

	try {
		await execFileAsync('osascript', [
			'-e', 'set imageData to the clipboard as "PNGf"',
			'-e', `set fileRef to open for access POSIX file "${tmpPath}" with write permission`,
			'-e', 'set eof fileRef to 0',
			'-e', 'write imageData to fileRef',
			'-e', 'close access fileRef',
		]);
		const buffer = await readFile(tmpPath);
		const { unlink } = await import('node:fs/promises');
		await unlink(tmpPath).catch(() => {});
		if (buffer.length === 0) return null;

		const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
		const metadata: FileContent['metadata'] = { sizeBytes: buffer.length };
		const dims = readPngDimensions(buffer);
		if (dims) {
			metadata.width = dims.width;
			metadata.height = dims.height;
		}
		return {
			type: 'file',
			mime: 'image/png',
			filename: 'clipboard.png',
			url: dataUrl,
			source: { type: 'clipboard' },
			metadata,
		};
	} catch {
		return null;
	}
}

async function readClipboardWindows(): Promise<FileContent | null> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execFileAsync = promisify(execFile);

	try {
		const script =
			'Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }';
		const { stdout } = await execFileAsync('powershell.exe', ['-NonInteractive', '-NoProfile', '-command', script], {
			timeout: 5000,
		});
		const base64 = stdout.trim();
		if (!base64 || base64.length < 100) return null;

		const buffer = Buffer.from(base64, 'base64');
		const dataUrl = `data:image/png;base64,${base64}`;
		const metadata: FileContent['metadata'] = { sizeBytes: buffer.length };
		const dims = readPngDimensions(buffer);
		if (dims) {
			metadata.width = dims.width;
			metadata.height = dims.height;
		}
		return {
			type: 'file',
			mime: 'image/png',
			filename: 'clipboard.png',
			url: dataUrl,
			source: { type: 'clipboard' },
			metadata,
		};
	} catch {
		return null;
	}
}

async function readClipboardLinux(): Promise<FileContent | null> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execFileAsync = promisify(execFile);

	// Try Wayland first, then X11
	for (const cmd of [
		{ name: 'wl-paste', args: ['-t', 'image/png'] },
		{ name: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] },
	]) {
		try {
			const { stdout } = await execFileAsync(cmd.name, cmd.args, { timeout: 3000, encoding: 'buffer' });
			const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
			if (buffer.length < 100) continue;

			const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
			const metadata: FileContent['metadata'] = { sizeBytes: buffer.length };
			const dims = readPngDimensions(buffer);
			if (dims) {
				metadata.width = dims.width;
				metadata.height = dims.height;
			}
			return {
				type: 'file',
				mime: 'image/png',
				filename: 'clipboard.png',
				url: dataUrl,
				source: { type: 'clipboard' },
				metadata,
			};
		} catch {
			continue;
		}
	}
	return null;
}
