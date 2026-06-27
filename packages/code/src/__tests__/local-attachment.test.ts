import { describe, it, expect } from 'vitest';
import { detectMime, resolvePastedFilePath, formatFileSize } from '../tui/utils/local-attachment.js';

describe('local-attachment', () => {
	describe('detectMime', () => {
		it('detects PNG', () => expect(detectMime('photo.png')).toBe('image/png'));
		it('detects JPEG', () => expect(detectMime('img.jpg')).toBe('image/jpeg'));
		it('detects GIF', () => expect(detectMime('anim.gif')).toBe('image/gif'));
		it('detects WebP', () => expect(detectMime('img.webp')).toBe('image/webp'));
		it('detects PDF', () => expect(detectMime('doc.pdf')).toBe('application/pdf'));
		it('detects MP3', () => expect(detectMime('song.mp3')).toBe('audio/mpeg'));
		it('detects WAV', () => expect(detectMime('clip.wav')).toBe('audio/wav'));
		it('detects MP4', () => expect(detectMime('video.mp4')).toBe('video/mp4'));
		it('detects TypeScript', () => expect(detectMime('index.ts')).toBe('text/typescript'));
		it('detects TSX', () => expect(detectMime('App.tsx')).toBe('text/typescript'));
		it('detects JavaScript', () => expect(detectMime('lib.js')).toBe('text/javascript'));
		it('detects JSON', () => expect(detectMime('config.json')).toBe('application/json'));
		it('detects YAML', () => expect(detectMime('config.yaml')).toBe('text/yaml'));
		it('detects Markdown', () => expect(detectMime('README.md')).toBe('text/markdown'));
		it('detects Python', () => expect(detectMime('main.py')).toBe('text/x-python'));
		it('detects Rust', () => expect(detectMime('main.rs')).toBe('text/x-rust'));
		it('detects Go', () => expect(detectMime('main.go')).toBe('text/x-go'));
		it('detects shell', () => expect(detectMime('run.sh')).toBe('text/x-shellscript'));
		it('detects HTML', () => expect(detectMime('index.html')).toBe('text/html'));
		it('detects CSS', () => expect(detectMime('style.css')).toBe('text/css'));
		it('detects ZIP', () => expect(detectMime('archive.zip')).toBe('application/zip'));
		it('detects TAR', () => expect(detectMime('archive.tar')).toBe('application/x-tar'));
		it('falls back to octet-stream for unknown', () => expect(detectMime('data.bin')).toBe('application/octet-stream'));
		it('is case-insensitive on extension', () => expect(detectMime('FILE.PNG')).toBe('image/png'));
	});

	describe('resolvePastedFilePath', () => {
		it('resolves Windows absolute paths', () => {
			expect(resolvePastedFilePath('C:\\Users\\test\\file.ts', 'win32')).toBe('C:\\Users\\test\\file.ts');
		});
		it('resolves Windows UNC paths', () => {
			expect(resolvePastedFilePath('\\\\server\\share\\file.ts', 'win32')).toBe('\\\\server\\share\\file.ts');
		});
		it('resolves POSIX absolute paths', () => {
			expect(resolvePastedFilePath('/home/user/file.ts', 'linux')).toBe('/home/user/file.ts');
		});
		it('resolves file:// URLs on Windows', () => {
			const result = resolvePastedFilePath('file:///C:/test/file.ts', 'win32');
			expect(result).toBeTruthy();
			expect(result).toContain('file.ts');
		});
		it('resolves file:// URLs on POSIX', () => {
			const result = resolvePastedFilePath('file:///home/user/file.ts', 'linux');
			expect(result).toBeTruthy();
		});
		it('strips surrounding quotes', () => {
			expect(resolvePastedFilePath('"C:\\test\\file.ts"', 'win32')).toBe('C:\\test\\file.ts');
		});
		it('strips single quotes', () => {
			expect(resolvePastedFilePath("'C:\\test\\file.ts'", 'win32')).toBe('C:\\test\\file.ts');
		});
		it('rejects http URLs', () => {
			expect(resolvePastedFilePath('https://example.com', 'linux')).toBeNull();
		});
		it('rejects ftp URLs', () => {
			expect(resolvePastedFilePath('ftp://files.example.com', 'linux')).toBeNull();
		});
		it('rejects sentences with multiple spaces', () => {
			expect(resolvePastedFilePath('this is a sentence with spaces', 'linux')).toBeNull();
		});
		it('rejects empty strings', () => {
			expect(resolvePastedFilePath('', 'linux')).toBeNull();
		});
		it('rejects relative paths on POSIX', () => {
			expect(resolvePastedFilePath('src/file.ts', 'linux')).toBeNull();
		});
		it('rejects paths without drive letter on Windows', () => {
			expect(resolvePastedFilePath('src\\file.ts', 'win32')).toBeNull();
		});
	});

	describe('formatFileSize', () => {
		it('formats bytes', () => expect(formatFileSize(500)).toBe('500B'));
		it('formats exactly 1KB', () => expect(formatFileSize(1024)).toBe('1.0KB'));
		it('formats KB', () => expect(formatFileSize(1536)).toBe('1.5KB'));
		it('formats exactly 1MB', () => expect(formatFileSize(1024 * 1024)).toBe('1.0MB'));
		it('formats MB', () => expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5MB'));
		it('formats zero', () => expect(formatFileSize(0)).toBe('0B'));
	});
});
