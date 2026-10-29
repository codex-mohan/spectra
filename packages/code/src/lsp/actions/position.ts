import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveSymbolColumn, toLspLine } from '../positions.js';

export interface ResolvedPosition {
	line: number;
	character: number;
}

export function resolvePosition(file: string, line: number | undefined, symbol: string | undefined): ResolvedPosition {
	const targetLine = Math.max(1, Math.floor(line ?? 1));
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/);
	const text = lines[targetLine - 1];
	if (text === undefined) throw new Error(`Line ${targetLine} is outside ${file}`);
	if (!symbol) return { line: toLspLine(targetLine), character: 0 };
	const character = resolveSymbolColumn(text, symbol);
	if (character === null) throw new Error(`Symbol "${symbol}" not found on line ${targetLine}`);
	return { line: toLspLine(targetLine), character };
}
