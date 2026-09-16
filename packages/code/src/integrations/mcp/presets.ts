/**
 * Curated starting points for the add-server flow. Every package and
 * environment variable below was verified against its published README.
 *
 * Values wrapped in `<...>` are placeholders: the dialog refuses to save a
 * server until the user replaces them.
 */
export interface McpPreset {
	id: string;
	name: string;
	description: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export const MCP_PRESETS: readonly McpPreset[] = [
	{
		id: 'filesystem',
		name: 'Filesystem',
		description: 'Read and write files under a directory',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-filesystem', '<directory-to-share>'],
	},
	{
		id: 'memory',
		name: 'Memory',
		description: 'Knowledge-graph memory persisted across sessions',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-memory'],
	},
	{
		id: 'sequential-thinking',
		name: 'Sequential Thinking',
		description: 'Structured step-by-step reasoning scratchpad',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
	},
	{
		id: 'everything',
		name: 'Everything',
		description: 'Reference server exercising every MCP feature',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-everything'],
	},
	{
		id: 'github',
		name: 'GitHub',
		description: 'Issues, pull requests, and repository search',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<github-personal-access-token>' },
	},
	{
		id: 'playwright',
		name: 'Playwright',
		description: 'Drive a real browser for UI checks and scraping',
		command: 'npx',
		args: ['-y', '@playwright/mcp@latest'],
	},
	{
		id: 'chrome-devtools',
		name: 'Chrome DevTools',
		description: 'Inspect pages, console, network, and performance',
		command: 'npx',
		args: ['-y', 'chrome-devtools-mcp@latest'],
	},
	{
		id: 'context7',
		name: 'Context7',
		description: 'Up-to-date library documentation lookup',
		command: 'npx',
		args: ['-y', '@upstash/context7-mcp'],
		env: { CONTEXT7_API_KEY: '<context7-api-key>' },
	},
	{
		id: 'firecrawl',
		name: 'Firecrawl',
		description: 'Crawl and scrape sites into clean markdown',
		command: 'npx',
		args: ['-y', 'firecrawl-mcp'],
		env: { FIRECRAWL_API_KEY: '<firecrawl-api-key>' },
	},
	{
		id: 'notion',
		name: 'Notion',
		description: 'Search and update Notion pages and databases',
		command: 'npx',
		args: ['-y', '@notionhq/notion-mcp-server'],
		env: { NOTION_TOKEN: '<notion-integration-token>' },
	},
	{
		id: 'slack',
		name: 'Slack',
		description: 'Read channels and post messages',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-slack'],
		env: { SLACK_BOT_TOKEN: '<slack-bot-token>', SLACK_CHANNEL_IDS: '<channel-id,channel-id>' },
	},
	{
		id: 'brave-search',
		name: 'Brave Search',
		description: 'Web and local search',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-brave-search'],
		env: { BRAVE_API_KEY: '<brave-api-key>' },
	},
	{
		id: 'google-maps',
		name: 'Google Maps',
		description: 'Geocoding, directions, and place details',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-google-maps'],
		env: { GOOGLE_MAPS_API_KEY: '<google-maps-api-key>' },
	},
	{
		id: 'postgres',
		name: 'PostgreSQL',
		description: 'Read-only SQL against a Postgres database',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-postgres', '<postgresql-connection-string>'],
	},
];
