import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ImageContent } from '@mohanscodex/spectra-ai';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

export function imageMimeType(filePath: string): string | undefined {
	return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
}

export async function loadImageContent(filePath: string): Promise<{ image: ImageContent; note: string }> {
	const mimeType = imageMimeType(filePath);
	if (!mimeType) throw new Error(`Unsupported image format: ${path.extname(filePath) || '(none)'}`);
	let stat;
	try {
		stat = await fs.stat(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`File not found: ${filePath}`);
		throw error;
	}
	if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
	if (stat.size > MAX_IMAGE_BYTES) throw new Error(`Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MiB: ${filePath}`);
	const bytes = await fs.readFile(filePath);
	return {
		image: { type: 'image', data: bytes.toString('base64'), mimeType },
		note: `Read image file [${mimeType}] (${bytes.byteLength} bytes)`,
	};
}
