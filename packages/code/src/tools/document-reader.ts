import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import mammoth from 'mammoth';
import * as mupdf from 'mupdf';
import TurndownService from 'turndown';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.epub', '.rtf', '.ipynb']);
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: false });

export function isConvertibleDocument(filePath: string): boolean {
	return DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function htmlToMarkdown(html: string): string {
	const service = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
	service.remove(['script', 'style', 'noscript']);
	return service.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
}

function xmlText(node: unknown): string[] {
	if (node === null || node === undefined) return [];
	if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return [String(node)];
	if (Array.isArray(node)) return node.flatMap(xmlText);
	if (typeof node !== 'object') return [];
	const record = node as Record<string, unknown>;
	const direct = record['#text'];
	const values = direct === undefined ? [] : xmlText(direct);
	for (const [key, value] of Object.entries(record)) {
		if (key === '#text' || key.startsWith('@_')) continue;
		values.push(...xmlText(value));
	}
	return values;
}

function decodeZipText(entries: Record<string, Uint8Array>, name: string): string | undefined {
	const bytes = entries[name];
	return bytes ? decoder.decode(bytes) : undefined;
}

async function convertPdf(bytes: Uint8Array): Promise<string> {
	const document = mupdf.Document.openDocument(bytes, 'application/pdf');
	try {
		const pages: string[] = [];
		for (let index = 0; index < document.countPages(); index++) {
			const page = document.loadPage(index);
			try {
				const text = page.toStructuredText('preserve-whitespace').asText().trim();
				pages.push(`## Page ${index + 1}\n\n${text || '(no extractable text)'}`);
			} finally {
				page.destroy();
			}
		}
		return pages.join('\n\n');
	} finally {
		document.destroy();
	}
}

async function convertDocx(bytes: Buffer): Promise<string> {
	const result = await mammoth.convertToHtml({ buffer: bytes });
	const markdown = htmlToMarkdown(result.value);
	const warnings = result.messages.map((message) => `${message.type}: ${message.message}`);
	return warnings.length > 0 ? `${markdown}\n\n<!-- Conversion warnings: ${warnings.join('; ')} -->` : markdown;
}

function convertPptx(bytes: Uint8Array): string {
	const entries = unzipSync(bytes);
	const parser = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
	const slides = Object.keys(entries)
		.filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
		.sort((left, right) => Number(/slide(\d+)/i.exec(left)?.[1]) - Number(/slide(\d+)/i.exec(right)?.[1]));
	return slides.map((name, index) => {
		const parsed = parser.parse(decoder.decode(entries[name])) as Record<string, unknown>;
		const text = xmlText(parsed).map((value) => value.trim()).filter(Boolean);
		const [title, ...body] = text;
		return [`<!-- Slide ${index + 1} -->`, title ? `# ${title}` : `# Slide ${index + 1}`, ...body].join('\n\n');
	}).join('\n\n');
}

function convertXlsx(bytes: Uint8Array): string {
	const entries = unzipSync(bytes);
	const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
	const sharedXml = decodeZipText(entries, 'xl/sharedStrings.xml');
	const shared = sharedXml ? xmlText(parser.parse(sharedXml)).filter((value) => value.trim().length > 0) : [];
	const sheets = Object.keys(entries)
		.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
		.sort((left, right) => Number(/sheet(\d+)/i.exec(left)?.[1]) - Number(/sheet(\d+)/i.exec(right)?.[1]));
	return sheets.map((name, sheetIndex) => {
		const parsed = parser.parse(decoder.decode(entries[name])) as any;
		const rawRows = parsed?.worksheet?.sheetData?.row;
		const rows = (Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : []).map((row: any) => {
			const cells = Array.isArray(row.c) ? row.c : row.c ? [row.c] : [];
			return cells.map((cell: any) => {
				const value = cell.v ?? cell.is?.t ?? '';
				return cell['@_t'] === 's' ? shared[Number(value)] ?? '' : String(typeof value === 'object' ? value['#text'] ?? '' : value);
			});
		});
		if (rows.length === 0) return `## Sheet ${sheetIndex + 1}\n\n(empty)`;
		const width = Math.max(...rows.map((row: string[]) => row.length));
		for (const row of rows) while (row.length < width) row.push('');
		const [header, ...body] = rows;
		return [`## Sheet ${sheetIndex + 1}`, `| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...body.map((row: string[]) => `| ${row.join(' | ')} |`)].join('\n');
	}).join('\n\n');
}

function convertEpub(bytes: Uint8Array): string {
	const entries = unzipSync(bytes);
	const pages = Object.keys(entries).filter((name) => /\.(?:xhtml|html|htm)$/i.test(name)).sort();
	return pages.map((name) => htmlToMarkdown(decoder.decode(entries[name]))).filter(Boolean).join('\n\n---\n\n');
}

function convertRtf(content: string): string {
	return content
		.replace(/\\par[d]?\b/g, '\n')
		.replace(/\\tab\b/g, '\t')
		.replace(/\\'[0-9a-fA-F]{2}/g, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
		.replace(/\\[a-zA-Z]+-?\d* ?/g, '')
		.replace(/[{}]/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function convertNotebook(content: string): string {
	const notebook = JSON.parse(content) as { cells?: Array<{ cell_type?: string; source?: string | string[]; outputs?: Array<Record<string, unknown>> }> };
	return (notebook.cells ?? []).map((cell) => {
		const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source ?? '';
		if (cell.cell_type === 'markdown') return source.trim();
		if (cell.cell_type === 'code') {
			const outputs = (cell.outputs ?? []).flatMap((output) => {
				const text = output.text ?? (output.data as Record<string, unknown> | undefined)?.['text/plain'];
				return Array.isArray(text) ? text.join('') : typeof text === 'string' ? text : [];
			}).join('\n');
			return `\`\`\`python\n${source.trimEnd()}\n\`\`\`${outputs ? `\n\nOutput:\n\n\`\`\`text\n${outputs.trimEnd()}\n\`\`\`` : ''}`;
		}
		return source.trim();
	}).filter(Boolean).join('\n\n');
}

export async function convertDocument(filePath: string): Promise<string> {
	const stat = await fs.stat(filePath);
	if (stat.size > MAX_DOCUMENT_BYTES) throw new Error(`Document exceeds ${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB: ${filePath}`);
	const bytes = await fs.readFile(filePath);
	const extension = path.extname(filePath).toLowerCase();
	switch (extension) {
		case '.pdf': return convertPdf(bytes);
		case '.docx': return convertDocx(bytes);
		case '.pptx': return convertPptx(bytes);
		case '.xlsx': return convertXlsx(bytes);
		case '.epub': return convertEpub(bytes);
		case '.rtf': return convertRtf(bytes.toString('latin1'));
		case '.ipynb': return convertNotebook(bytes.toString('utf8'));
		default: throw new Error(`Unsupported document format: ${extension}`);
	}
}
