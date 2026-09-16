import * as path from 'node:path';

const SQLITE_PATH_PATTERN = /\.(?:sqlite3?|db3?)(?=[:?]|$)/gi;
const MAX_ROWS = 1000;

type SqliteBindings = unknown[];
type SqliteRow = Record<string, unknown>;

interface SqliteStatement {
	all(...bindings: SqliteBindings): unknown[];
	get(...bindings: SqliteBindings): unknown;
}

interface SqliteDatabase {
	query(sql: string): SqliteStatement;
	close(): void;
}

function openReadonlyDatabase(filePath: string): SqliteDatabase {
	try {
		const { Database } = require('bun:sqlite') as { Database: new (path: string, options: { readonly: boolean; strict: boolean }) => SqliteDatabase };
		return new Database(filePath, { readonly: true, strict: true });
	} catch {
		const Database = require('better-sqlite3') as new (path: string, options: { readonly: boolean; fileMustExist: boolean }) => SqliteDatabase;
		return new Database(filePath, { readonly: true, fileMustExist: true });
	}
}

export interface SqlitePath {
	databasePath: string;
	table?: string;
	key?: string;
	query: URLSearchParams;
}

export function parseSqlitePath(input: string, cwd: string): SqlitePath | undefined {
	let selected: RegExpExecArray | null = null;
	for (const match of input.matchAll(SQLITE_PATH_PATTERN)) selected = match;
	if (!selected || selected.index === undefined) return undefined;
	const end = selected.index + selected[0].length;
	const remainder = input.slice(end);
	const queryIndex = remainder.indexOf('?');
	const selector = (queryIndex === -1 ? remainder : remainder.slice(0, queryIndex)).replace(/^:/, '');
	const [table, ...keyParts] = selector.split(':');
	return { databasePath: path.resolve(cwd, input.slice(0, end)), table: table ? decodeURIComponent(table) : undefined, key: keyParts.length > 0 ? decodeURIComponent(keyParts.join(':')) : undefined, query: new URLSearchParams(queryIndex === -1 ? '' : remainder.slice(queryIndex + 1)) };
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeRows(rows: SqliteRow[]): SqliteRow[] {
	return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? `<BLOB ${value.byteLength} bytes>` : typeof value === 'bigint' ? value.toString() : value])));
}

function assertReadOnlyQuery(sql: string): void {
	const normalized = sql.trim().replace(/^--.*$/gm, '').trim();
	if (!/^(?:select|with|pragma\s+(?:table_info|table_xinfo|index_list|index_info|foreign_key_list)\b|explain\s+query\s+plan)\b/i.test(normalized) || /;\s*\S|\b(?:insert|update|delete|replace|drop|alter|create|attach|detach|vacuum|reindex)\b/i.test(normalized)) throw new Error('SQLite query must be a single read-only SELECT, WITH, safe PRAGMA inspection, or EXPLAIN QUERY PLAN statement');
}

export function readSqlite(input: SqlitePath): string {
	const database = openReadonlyDatabase(input.databasePath);
	try {
		const rawSql = input.query.get('q');
		if (rawSql) {
			assertReadOnlyQuery(rawSql);
			const rows = database.query(rawSql).all().slice(0, MAX_ROWS) as SqliteRow[];
			return JSON.stringify({ rows: normalizeRows(rows), truncated: rows.length === MAX_ROWS }, null, 2);
		}
		if (!input.table) return JSON.stringify({ database: input.databasePath, tables: normalizeRows(database.query("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as SqliteRow[]) }, null, 2);
		const exists = database.query("SELECT 1 AS found FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1").get(input.table);
		if (!exists) throw new Error(`SQLite table not found: ${input.table}`);
		const table = quoteIdentifier(input.table);
		const schema = database.query(`PRAGMA table_info(${table})`).all() as SqliteRow[];
		if (input.key !== undefined) {
			const primaryKey = schema.find((row) => Number(row.pk) > 0)?.name;
			const key = typeof primaryKey === 'string' ? quoteIdentifier(primaryKey) : 'rowid';
			const row = database.query(`SELECT * FROM ${table} WHERE ${key} = ? LIMIT 1`).get(input.key) as SqliteRow | null;
			if (!row) throw new Error(`SQLite row not found: ${input.table}:${input.key}`);
			return JSON.stringify({ table: input.table, key: input.key, row: normalizeRows([row])[0] }, null, 2);
		}
		const limit = Math.min(MAX_ROWS, Math.max(1, Number(input.query.get('limit') ?? 20) || 20));
		const offset = Math.max(0, Number(input.query.get('offset') ?? 0) || 0);
		const order = input.query.get('order');
		const where = input.query.get('where');
		let sql = `SELECT * FROM ${table}`;
		if (where) {
			if (/[;]|--|\/\*/.test(where)) throw new Error('SQLite where clause contains forbidden syntax');
			sql += ` WHERE ${where}`;
		}
		if (order) {
			const [column, direction = 'ASC'] = order.trim().split(/\s+/);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column) || !/^(?:ASC|DESC)$/i.test(direction)) throw new Error('SQLite order must be <column> [ASC|DESC]');
			sql += ` ORDER BY ${quoteIdentifier(column)} ${direction.toUpperCase()}`;
		}
		const rows = database.query(`${sql} LIMIT ? OFFSET ?`).all(limit, offset) as SqliteRow[];
		return JSON.stringify({ table: input.table, schema: normalizeRows(schema), rows: normalizeRows(rows), limit, offset }, null, 2);
	} finally {
		database.close();
	}
}
