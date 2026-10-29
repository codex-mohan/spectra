import { defineConfig } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

export default defineConfig({
	title: 'Spectra',
	description: 'Terminal-native AI coding agent with extensible TypeScript and Rust SDKs for building and orchestrating coding workflows',
	base: '/spectra/',
	lastUpdated: true,
	cleanUrls: true,
	srcExclude: ['features/_TEMPLATE.md'],
	vite: {
		plugins: [
			llmstxt({
				domain: 'https://codex-mohan.github.io/spectra',
				generateLLMsTxt: true,
				generateLLMsFullTxt: true,
				generateLLMFriendlyDocsForEachPage: true,
			}),
		],
	},
	themeConfig: {
		logo: { light: '/logo.svg', dark: '/logo.svg' },
		nav: [
			{ text: 'Guide', link: '/getting-started/introduction' },
			{ text: 'TypeScript', link: '/typescript/overview' },
			{ text: 'Rust', link: '/rust/overview' },
			{ text: 'Guides', link: '/guides/adding-a-provider' },
			{ text: 'Recipes', link: '/recipes/weather-agent' },
			{ text: 'Reference', link: '/reference/typescript/agent' },
			{ text: 'GitHub', link: 'https://github.com/codex-mohan/spectra' },
		],
		sidebar: {
			'/getting-started/': [
				{
					text: 'Getting Started',
					items: [
						{ text: 'Introduction', link: '/getting-started/introduction' },
						{ text: 'Installation', link: '/getting-started/installation' },
						{ text: 'Quickstart', link: '/getting-started/quickstart' },
						{ text: 'Project Structure', link: '/getting-started/project-structure' },
					],
				},
			],
			'/typescript/': [
				{
					text: 'TypeScript SDK',
					items: [
						{ text: 'Overview', link: '/typescript/overview' },
						{ text: 'Agent', link: '/typescript/agent' },
						{ text: 'Tools', link: '/typescript/tools' },
						{ text: 'Providers', link: '/typescript/providers' },
						{ text: 'Events', link: '/typescript/events' },
						{ text: 'Session Management', link: '/typescript/sessions' },
						{ text: 'Orchestration', link: '/typescript/orchestration' },
					],
				},
			],
			'/rust/': [
				{
					text: 'Rust SDK',
					items: [
						{ text: 'Overview', link: '/rust/overview' },
						{ text: 'Getting Started', link: '/rust/getting-started' },
						{ text: 'Agent', link: '/rust/agent' },
						{ text: 'Tools', link: '/rust/tools' },
						{ text: 'Providers', link: '/rust/providers' },
						{ text: 'Events', link: '/rust/events' },
						{ text: 'Extensions', link: '/rust/extensions' },
					],
				},
			],
			'/guides/': [
				{
					text: 'How-To Guides',
					items: [
						{ text: 'Adding a Provider', link: '/guides/adding-a-provider' },
						{ text: 'Tool Design Patterns', link: '/guides/tool-design-patterns' },
						{ text: 'Error Handling', link: '/guides/error-handling' },
						{ text: 'Prompt Engineering', link: '/guides/prompt-engineering' },
						{ text: 'Multi-Agent Patterns', link: '/guides/multi-agent-patterns' },
						{ text: 'Streaming UI', link: '/guides/streaming-ui' },
						{ text: 'Session Management', link: '/guides/session-management' },
						{ text: 'Deployment', link: '/guides/deployment' },
					],
				},
			],
			'/recipes/': [
				{
					text: 'Recipes',
					items: [
						{ text: 'Weather Agent', link: '/recipes/weather-agent' },
						{ text: 'Web Search Agent', link: '/recipes/web-search-agent' },
						{ text: 'RAG Agent', link: '/recipes/rag-agent' },
						{ text: 'Multi-Agent Research', link: '/recipes/multi-agent-research' },
						{ text: 'Chatbot with Sessions', link: '/recipes/chatbot-with-sessions' },
						{ text: 'Rate-Limited API', link: '/recipes/rate-limited-api' },
					],
				},
			],
			'/concepts/': [
				{
					text: 'Concepts',
					items: [
						{ text: 'Agent Loop', link: '/concepts/agent-loop' },
						{ text: 'Streaming Architecture', link: '/concepts/streaming-architecture' },
						{ text: 'TypeScript vs Rust', link: '/concepts/ts-vs-rust' },
						{ text: 'Tool Dispatch', link: '/concepts/tool-dispatch' },
						{ text: 'Event System', link: '/concepts/event-system' },
					],
				},
			],
			'/reference/': [
				{
					text: 'TypeScript Reference',
					items: [
						{ text: 'Agent', link: '/reference/typescript/agent' },
						{ text: 'defineTool', link: '/reference/typescript/define-tool' },
						{ text: 'EventStream', link: '/reference/typescript/event-stream' },
						{ text: 'Types', link: '/reference/typescript/types' },
						{ text: 'SessionManager', link: '/reference/typescript/session-manager' },
						{ text: 'SessionEngine', link: '/reference/typescript/session-engine' },
						{ text: 'RateLimiter', link: '/reference/typescript/rate-limiter' },
						{ text: 'WorkerPool', link: '/reference/typescript/worker-pool' },
						{ text: 'AgentRegistry', link: '/reference/typescript/agent-registry' },
						{ text: 'CircuitBreaker', link: '/reference/typescript/circuit-breaker' },
					],
				},
				{
					text: 'Rust Reference',
					items: [
						{ text: 'AgentBuilder', link: '/reference/rust/agent-builder' },
						{ text: 'LlmClient', link: '/reference/rust/llm-client' },
						{ text: 'Tool', link: '/reference/rust/tool' },
						{ text: 'Messages', link: '/reference/rust/messages' },
						{ text: 'Events', link: '/reference/rust/events' },
						{ text: 'Extension', link: '/reference/rust/extension' },
						{ text: 'Error', link: '/reference/rust/error' },
						{ text: 'ModelRegistry', link: '/reference/rust/model-registry' },
					],
				},
			],
			'/features/': [
				{
					text: 'Feature Contracts',
					items: [
						{ text: 'Index', link: '/features/' },
						{ text: 'Agent Loop', link: '/features/agent-loop' },
						{ text: 'Providers', link: '/features/providers' },
						{ text: 'Tool Registry', link: '/features/tool-registry' },
						{ text: 'Read', link: '/features/read' },
						{ text: 'Write', link: '/features/write' },
						{ text: 'Edit', link: '/features/edit' },
						{ text: 'Hashline', link: '/features/hashline' },
						{ text: 'Shell', link: '/features/shell' },
						{ text: 'Search', link: '/features/search' },
						{ text: 'Web Fetch', link: '/features/web-fetch' },
						{ text: 'Web Search', link: '/features/web-search' },
						{ text: 'LSP', link: '/features/lsp' },
						{ text: 'MCP Client', link: '/features/mcp-client' },
						{ text: 'ACP Server', link: '/features/acp-server' },
						{ text: 'Permissions', link: '/features/permissions' },
						{ text: 'Sessions', link: '/features/sessions' },
						{ text: 'Snapshots', link: '/features/snapshots' },
						{ text: 'Commands & Templates', link: '/features/commands-templates' },
						{ text: 'Skills', link: '/features/skills' },
						{ text: 'Model Service', link: '/features/model-service' },
						{ text: 'Config', link: '/features/config' },
						{ text: 'Custom Providers', link: '/features/custom-providers' },
						{ text: 'TUI Shell', link: '/features/tui-shell' },
						{ text: 'Input Lifecycle', link: '/features/input-lifecycle' },
						{ text: 'Doctor', link: '/features/doctor' },
						{ text: 'Context Compaction', link: '/features/context-compaction' },
						{ text: 'Todo Tool', link: '/features/todo-tool' },
						{ text: 'Memory Tool', link: '/features/memory-tool' },
						{ text: 'Custom Tools', link: '/features/custom-tools' },
					],
				},
			],
			'/troubleshooting/': [
				{
					text: 'Troubleshooting',
					items: [
						{ text: 'Common Issues', link: '/troubleshooting/common-issues' },
						{ text: 'Debugging', link: '/troubleshooting/debugging' },
						{ text: 'FAQ', link: '/troubleshooting/faq' },
					],
				},
			],
			'/contribute/': [
				{
					text: 'Contributing',
					items: [
						{ text: 'Setup', link: '/contribute/setup' },
						{ text: 'Adding Providers', link: '/contribute/adding-providers' },
						{ text: 'Coding Standards', link: '/contribute/coding-standards' },
						{ text: 'Architecture Decisions', link: '/contribute/architecture-decisions' },
					],
				},
			],
			// Legacy paths — keep for backward compat during migration
			'/guide/': [
				{
					text: 'Guide (Legacy)',
					items: [
						{ text: 'Getting Started', link: '/guide/getting-started' },
						{ text: 'Agent', link: '/guide/agent' },
						{ text: 'Tools', link: '/guide/tools' },
						{ text: 'Providers', link: '/guide/providers' },
						{ text: 'Events', link: '/guide/events' },
						{ text: 'Session Management', link: '/guide/sessions' },
						{ text: 'Orchestration & Concurrency', link: '/guide/orchestration' },
						{ text: 'Rust SDK', link: '/guide/rust' },
					],
				},
			],
			'/api/': [
				{
					text: 'TypeScript API (Legacy)',
					items: [
						{ text: 'Agent', link: '/api/agent' },
						{ text: 'Tools', link: '/api/tools' },
						{ text: 'Events', link: '/api/events' },
						{ text: 'Providers', link: '/api/providers' },
						{ text: 'App (Sessions, Orchestration)', link: '/api/app' },
					],
				},
				{
					text: 'Rust API (Legacy)',
					items: [{ text: 'Overview', link: '/api/rust' }],
				},
			],
		},
		socialLinks: [{ icon: 'github', link: 'https://github.com/codex-mohan/spectra' }],
		footer: {
			message: 'Released under the MIT License.',
			copyright: 'Copyright 2026-present Spectra',
		},
	},
});
