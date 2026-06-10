export function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

export function parseStreamingJson(json: string): Record<string, unknown> {
	try {
		return JSON.parse(json);
	} catch {
		return {};
	}
}
