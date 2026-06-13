import { useRef, useCallback } from 'react';

interface GenerateTitleOptions {
	model: string;
	provider: string;
	getApiKey: (provider: string) => string | undefined;
	userMessage: string;
	assistantMessage: string;
}

export function useTitleAgent() {
	const hasGenerated = useRef(false);

	const generateTitle = useCallback(async (opts: GenerateTitleOptions): Promise<string | null> => {
		if (hasGenerated.current) return null;
		hasGenerated.current = true;

		try {
			const { stream } = await import('@mohanscodex/spectra-ai');

			const prompt = `Generate a concise session title (3-6 words) for this conversation.

User: ${opts.userMessage.slice(0, 500)}
Assistant: ${opts.assistantMessage.slice(0, 500)}

Rules:
- 3-6 words maximum
- Summarize the topic or task
- No quotes, no punctuation at the end
- Title case
- Be specific, not generic

Return ONLY the title text, nothing else.`;

			let title = '';
			const modelObj = { id: opts.model, name: opts.model, provider: opts.provider, api: opts.provider };
			const ctx = { messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }] };
			const events = stream(
				modelObj as any,
				ctx,
				{ apiKey: opts.getApiKey(opts.provider) },
			);

			for await (const event of events) {
				if (event.type === 'text_delta' && event.delta) {
					title += event.delta;
				}
			}

			title = title.trim()
				.replace(/^["']|["']$/g, '')
				.replace(/\.$/, '')
				.split('\n')[0]
				.trim();

			if (title.length > 50) title = title.slice(0, 50).trim();
			return title.length > 0 ? title : null;
		} catch {
			return null;
		}
	}, []);

	const reset = useCallback(() => {
		hasGenerated.current = false;
	}, []);

	return { generateTitle, reset };
}
