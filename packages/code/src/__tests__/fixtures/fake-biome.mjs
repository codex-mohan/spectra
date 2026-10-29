process.stdout.write(JSON.stringify({
	diagnostics: [
		{
			severity: 'error',
			message: 'Biome error',
			category: 'lint/test',
			location: { path: { file: process.argv[process.argv.length - 1] }, span: [0, 3] },
		},
	],
}));
