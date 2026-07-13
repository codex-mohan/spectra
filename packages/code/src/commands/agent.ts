import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CommandModule } from 'yargs';
import { loadAgentCatalog, invalidateAgentCatalog } from '../agents/index.js';

export const agentCommand: CommandModule = {
	command: 'agent',
	describe: 'Manage agents',
	builder: (yargs) =>
		yargs
			.command({
				command: 'list',
				describe: 'List available agents',
				handler: async () => {
					const catalog = await loadAgentCatalog(process.cwd());
					console.log('Primary agents:');
					for (const name of catalog.primary) {
						const def = catalog.definitions[name];
						const src = def?.source ? `  (${def.source})` : '';
						console.log(`  ${name.padEnd(16)} ${(def?.description || '').slice(0, 80)}${src}`);
					}
					console.log('Subagents:');
					for (const name of catalog.subagents) {
						const def = catalog.definitions[name];
						const src = def?.source ? `  (${def.source})` : '';
						console.log(`  ${name.padEnd(16)} ${(def?.description || '').slice(0, 80)}${src}`);
					}
					if (catalog.diagnostics.length) {
						console.log('Diagnostics:');
						for (const d of catalog.diagnostics) {
							console.log(`  ${d.sourcePath}: ${d.message}`);
						}
					}
				},
			})
			.command({
				command: 'create <name>',
				describe: 'Create a project agent markdown file under .spectra/agents',
				handler: (argv: Record<string, unknown>) => {
					const name = String(argv.name || '').trim().toLowerCase();
					if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
						console.error('Error: name must be lowercase letters, numbers, and hyphens.');
						process.exit(1);
					}
					const dir = join(process.cwd(), '.spectra', 'agents');
					mkdirSync(dir, { recursive: true });
					const filePath = join(dir, `${name}.md`);
					if (existsSync(filePath)) {
						console.error(`Error: ${filePath} already exists.`);
						process.exit(1);
					}
					const body = `---
name: ${name}
description: Describe when to use this agent.
mode: subagent
tools: read, grep, glob
---

You are the ${name} agent. State your role, constraints, and output format.
`;
					writeFileSync(filePath, body, 'utf-8');
					invalidateAgentCatalog();
					console.log(`Created ${filePath}`);
				},
			})
			.demandCommand(1, 'Please specify a subcommand'),
	handler: () => {},
};
