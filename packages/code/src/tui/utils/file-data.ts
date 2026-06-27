/**
 * Pure file/MIME data — no theme dependency.
 * Used by local-attachment.ts for detection, size limits, and MIME maps.
 */

// Extension → MIME type mapping (for clipboard/paste resolution)
export const EXTENSION_TO_MIME: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
	'.svg': 'image/svg+xml', '.pdf': 'application/pdf',
	'.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
	'.flac': 'audio/flac', '.aac': 'audio/aac',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
	'.avi': 'video/x-msvideo',
	'.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
	'.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
	'.scss': 'text/css', '.less': 'text/css',
	'.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
	'.ts': 'text/typescript', '.tsx': 'text/typescript', '.mts': 'text/typescript', '.cts': 'text/typescript',
	'.jsx': 'text/javascript', '.json': 'application/json',
	'.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml',
	'.toml': 'text/toml', '.py': 'text/x-python', '.pyi': 'text/x-python', '.rs': 'text/x-rust',
	'.go': 'text/x-go', '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript',
	'.zsh': 'text/x-shellscript', '.ps1': 'text/x-powershell',
	'.bat': 'text/plain', '.cmd': 'text/plain',
	'.zip': 'application/zip', '.tar': 'application/x-tar',
	'.gz': 'application/gzip', '.tgz': 'application/gzip', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
};

// Media type size limits (bytes)
export const MEDIA_SIZE_LIMITS: Record<string, number> = {
	image: 20 * 1024 * 1024,
	audio: 25 * 1024 * 1024,
	video: 50 * 1024 * 1024,
	document: 10 * 1024 * 1024,
	archive: 100 * 1024 * 1024,
};

/**
 * Get the size limit for a given MIME type.
 */
export function getSizeLimit(mime: string): number | undefined {
	if (mime.startsWith('image/')) return MEDIA_SIZE_LIMITS.image;
	if (mime.startsWith('audio/')) return MEDIA_SIZE_LIMITS.audio;
	if (mime.startsWith('video/')) return MEDIA_SIZE_LIMITS.video;
	if (mime === 'application/pdf' || isOfficeMime(mime) || mime.startsWith('text/')) return MEDIA_SIZE_LIMITS.document;
	if (isArchiveMime(mime)) return MEDIA_SIZE_LIMITS.archive;
	return undefined;
}

/**
 * Check if a MIME type is supported for attachment.
 */
export function isSupportedMime(mime: string): boolean {
	if (mime.startsWith('image/')) return true;
	if (mime.startsWith('audio/')) return true;
	if (mime.startsWith('video/')) return true;
	if (mime === 'application/pdf' || isOfficeMime(mime)) return true;
	if (mime.startsWith('text/')) return true;
	if (mime === 'application/json') return true;
	if (mime === 'application/xml') return true;
	if (mime === 'application/x-directory') return true;
	if (isArchiveMime(mime)) return true;
	return false;
}

function isOfficeMime(mime: string): boolean {
	return mime === 'application/msword'
		|| mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		|| mime === 'application/vnd.ms-excel'
		|| mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		|| mime === 'application/vnd.ms-powerpoint'
		|| mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
}

function isArchiveMime(mime: string): boolean {
	return mime === 'application/zip'
		|| mime === 'application/x-tar'
		|| mime === 'application/gzip'
		|| mime === 'application/x-7z-compressed'
		|| mime === 'application/vnd.rar';
}
