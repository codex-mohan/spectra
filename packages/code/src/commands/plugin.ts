import type { CommandModule } from 'yargs';

export const pluginCommand: CommandModule = {
	command: ['plugin', 'plug'],
	describe: 'Manage plugins',
	builder: (yargs) =>
		yargs
			.command({
				command: 'list',
				describe: 'List installed plugins',
				handler: () => {
					console.log('Installed plugins:');
					const configDir = process.env.XDG_CONFIG_HOME
						? `${process.env.XDG_CONFIG_HOME}/spectra`
						: `${process.env.HOME || '~'}/.config/spectra`;
					console.log(`  (No plugins installed. Add plugins via 'spectra plugin install <name>')`);
					console.log(`  Plugin directory: ${configDir}/plugins`);
				},
			})
			.command({
				command: 'install <name>',
				describe: 'Install a plugin',
				handler: (argv: Record<string, unknown>) => {
					console.log(`Installing plugin "${argv.name}"...`);
					console.log('(Plugin system loading — feature in development)');
				},
			})
			.command({
				command: 'remove <name>',
				describe: 'Remove a plugin',
				handler: (argv: Record<string, unknown>) => {
					console.log(`Removing plugin "${argv.name}"...`);
					console.log('(Plugin system loading — feature in development)');
				},
			})
			.demandCommand(1, 'Please specify a subcommand'),
	handler: () => {},
};
