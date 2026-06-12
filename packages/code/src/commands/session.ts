import type { CommandModule } from 'yargs';
import { SessionStore } from '../services/session-store.js';

export const sessionCommand: CommandModule = {
	command: 'session',
	describe: 'Manage sessions',
	builder: (yargs) =>
		yargs
			.command({
				command: 'list',
				describe: 'List all sessions',
				handler: () => {
					const store = new SessionStore();
					const sessions = store.list(process.cwd());
					if (sessions.length === 0) {
						console.log('No sessions found.');
						return;
					}
					for (const s of sessions) {
						const date = new Date(s.updated).toLocaleString();
						console.log(`${s.id.padEnd(20)} ${s.title.slice(0, 40).padEnd(42)} ${s.agent.padEnd(12)} ${date}`);
					}
				},
			})
			.command({
				command: 'delete <id>',
				describe: 'Delete a session',
				handler: (argv: Record<string, unknown>) => {
					const store = new SessionStore();
					const ok = store.delete(argv.id as string);
					if (ok) console.log(`Session ${argv.id} deleted.`);
					else console.error(`Session not found: ${argv.id}`);
					process.exit(ok ? 0 : 1);
				},
			})
			.command({
				command: 'load <id>',
				describe: 'Load a session into the TUI',
				handler: (argv: Record<string, unknown>) => {
					console.log(`Loading session ${argv.id}...`);
					(async () => {
						const { launchTui } = await import('../tui/index.js');
						await launchTui({ sessionId: argv.id as string });
					})();
				},
			})
			.demandCommand(1, 'Please specify a subcommand'),
	handler: () => {},
};
