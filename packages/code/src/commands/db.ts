import type { CommandModule } from 'yargs';
import { getGlobalDataDir } from '../utils/paths.js';
import { join } from 'path';

export const dbCommand: CommandModule = {
	command: 'db',
	describe: 'Database operations',
	builder: (yargs) =>
		yargs
			.command({
				command: 'path',
				describe: 'Show database path',
				handler: () => {
					const dataDir = getGlobalDataDir();
					console.log(join(dataDir, 'sessions', 'sessions.db'));
				},
			})
			.command({
				command: '$0 [query]',
				describe: 'Run a SQL query or open interactive shell',
				handler: (argv: Record<string, unknown>) => {
					const dbPath = join(getGlobalDataDir(), 'sessions', 'sessions.db');
					if (argv.query) {
						console.log(`Running SQL query: ${argv.query}`);
						try {
							let db: any;
							try {
								const { Database } = require('bun:sqlite');
								db = new Database(dbPath);
							} catch {
								const Database = require('better-sqlite3');
								db = new Database(dbPath);
							}
							const rows = db.prepare(String(argv.query)).all();
							console.log(JSON.stringify(rows, null, 2));
							db.close();
						} catch (err: unknown) {
							const error = err as { message?: string };
							console.error(`Query failed: ${error.message}`);
							process.exit(1);
						}
					} else {
						console.log(`Open interactive SQLite shell:
  sqlite3 ${dbPath}`);
					}
				},
			})
			.demandCommand(1, 'Please specify a subcommand'),
	handler: () => {},
};
