/**
 * Splits an argument string the way a shell would, so a path containing spaces
 * can be quoted: `-y server "C:/Program Files/app"`.
 *
 * Single quotes are literal, double quotes accept backslash escapes, and an
 * unterminated quote is treated as running to the end of the input rather than
 * being rejected.
 */
export function splitArguments(raw: string): string[] {
	const args: string[] = [];
	let current = '';
	let started = false;
	let quote: '"' | "'" | null = null;

	for (let index = 0; index < raw.length; index++) {
		const character = raw[index]!;

		if (quote === "'") {
			if (character === "'") quote = null;
			else current += character;
			continue;
		}

		if (quote === '"') {
			if (character === '"') {
				quote = null;
				continue;
			}
			if (character === '\\' && index + 1 < raw.length) {
				index += 1;
				current += raw[index]!;
				continue;
			}
			current += character;
			continue;
		}

		if (character === '"' || character === "'") {
			quote = character;
			started = true;
			continue;
		}

		if (character === '\\' && index + 1 < raw.length) {
			index += 1;
			current += raw[index]!;
			started = true;
			continue;
		}

		if (/\s/.test(character)) {
			if (started) {
				args.push(current);
				current = '';
				started = false;
			}
			continue;
		}

		current += character;
		started = true;
	}

	if (started) args.push(current);
	return args;
}

/** Quotes arguments so {@link splitArguments} round-trips them, including empty ones. */
export function formatArguments(args: readonly string[]): string {
	return args
		.map((arg) => (arg === '' || /[\s"'\\]/.test(arg) ? `"${arg.replace(/(["\\])/g, '\\$1')}"` : arg))
		.join(' ');
}
