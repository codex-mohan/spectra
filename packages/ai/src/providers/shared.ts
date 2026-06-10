export function sanitizeSurrogates(text: string): string {
	return text;
}

export function parseStreamingJson(json: string): Record<string, unknown> {
	try {
		return JSON.parse(json);
	} catch {
		return {};
	}
}
