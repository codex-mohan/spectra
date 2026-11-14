/** LaTeX-to-Unicode rendering for terminal markdown. Layout is intentionally approximate. */

const SYMBOLS: Record<string, string> = {
	alpha: 'α',
	beta: 'β',
	gamma: 'γ',
	delta: 'δ',
	epsilon: 'ε',
	varepsilon: 'ε',
	zeta: 'ζ',
	eta: 'η',
	theta: 'θ',
	vartheta: 'ϑ',
	iota: 'ι',
	kappa: 'κ',
	lambda: 'λ',
	mu: 'μ',
	nu: 'ν',
	xi: 'ξ',
	pi: 'π',
	rho: 'ρ',
	sigma: 'σ',
	tau: 'τ',
	upsilon: 'υ',
	phi: 'φ',
	varphi: 'φ',
	chi: 'χ',
	psi: 'ψ',
	omega: 'ω',
	Gamma: 'Γ',
	Delta: 'Δ',
	Theta: 'Θ',
	Lambda: 'Λ',
	Xi: 'Ξ',
	Pi: 'Π',
	Sigma: 'Σ',
	Upsilon: 'Υ',
	Phi: 'Φ',
	Psi: 'Ψ',
	Omega: 'Ω',
	sum: '∑',
	prod: '∏',
	coprod: '∐',
	int: '∫',
	iint: '∬',
	iiint: '∭',
	oint: '∮',
	infty: '∞',
	partial: '∂',
	nabla: '∇',
	pm: '±',
	mp: '∓',
	times: '×',
	div: '÷',
	cdot: '·',
	ast: '∗',
	star: '⋆',
	circ: '∘',
	bullet: '•',
	leq: '≤',
	le: '≤',
	geq: '≥',
	ge: '≥',
	neq: '≠',
	ne: '≠',
	approx: '≈',
	equiv: '≡',
	sim: '∼',
	simeq: '≃',
	cong: '≅',
	propto: '∝',
	ll: '≪',
	gg: '≫',
	to: '→',
	rightarrow: '→',
	leftarrow: '←',
	leftrightarrow: '↔',
	Rightarrow: '⇒',
	Leftarrow: '⇐',
	Leftrightarrow: '⇔',
	mapsto: '↦',
	uparrow: '↑',
	downarrow: '↓',
	in: '∈',
	notin: '∉',
	ni: '∋',
	subset: '⊂',
	subseteq: '⊆',
	supset: '⊃',
	supseteq: '⊇',
	cup: '∪',
	cap: '∩',
	setminus: '∖',
	emptyset: '∅',
	varnothing: '∅',
	forall: '∀',
	exists: '∃',
	nexists: '∄',
	neg: '¬',
	lnot: '¬',
	land: '∧',
	wedge: '∧',
	lor: '∨',
	vee: '∨',
	oplus: '⊕',
	otimes: '⊗',
	perp: '⊥',
	parallel: '∥',
	angle: '∠',
	triangle: '△',
	square: '□',
	checkmark: '✓',
	ldots: '…',
	dots: '…',
	cdots: '⋯',
	vdots: '⋮',
	ddots: '⋱',
	hbar: 'ℏ',
	ell: 'ℓ',
	aleph: 'ℵ',
	Re: 'ℜ',
	Im: 'ℑ',
	degree: '°',
	prime: '′',
};

const BLACKBOARD: Record<string, string> = {
	A: '𝔸', B: '𝔹', C: 'ℂ', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', H: 'ℍ', I: '𝕀', J: '𝕁',
	K: '𝕂', L: '𝕃', M: '𝕄', N: 'ℕ', O: '𝕆', P: 'ℙ', Q: 'ℚ', R: 'ℝ', S: '𝕊', T: '𝕋',
	U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏', Y: '𝕐', Z: 'ℤ',
};

const SUPERSCRIPT: Record<string, string> = {
	'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
	'+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', '.': '·', ' ': ' ',
	a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ',
	m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
	A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ', L: 'ᴸ', M: 'ᴹ', N: 'ᴺ',
	O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', T: 'ᵀ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ',
};

const SUBSCRIPT: Record<string, string> = {
	'0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
	'+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
	a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
	s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

const ACCENTS: Record<string, string> = {
	hat: '\u0302',
	widehat: '\u0302',
	bar: '\u0304',
	overline: '\u0305',
	vec: '\u20d7',
	tilde: '\u0303',
	dot: '\u0307',
	ddot: '\u0308',
	check: '\u030c',
	breve: '\u0306',
};

function readBraceGroup(text: string, start: number): { value: string; end: number } | null {
	let index = start;
	while (index < text.length && /\s/.test(text[index])) index++;
	if (text[index] !== '{') return null;
	let depth = 0;
	for (let cursor = index; cursor < text.length; cursor++) {
		if (text[cursor] === '{') depth++;
		else if (text[cursor] === '}') {
			depth--;
			if (depth === 0) return { value: text.slice(index + 1, cursor), end: cursor + 1 };
		}
	}
	return null;
}

function mapScript(text: string, table: Record<string, string>, marker: '^' | '_'): string {
	const converted = [...text].map((char) => table[char] ?? '').join('');
	return converted.length === [...text].length ? converted : `${marker}(${text})`;
}

function replaceGroups(text: string, command: string, build: (args: string[]) => string, argCount: 1 | 2): string {
	let output = '';
	let cursor = 0;
	const needle = `\\${command}`;
	for (;;) {
		const at = text.indexOf(needle, cursor);
		if (at < 0) {
			output += text.slice(cursor);
			return output;
		}
		output += text.slice(cursor, at);
		const args: string[] = [];
		let end = at + needle.length;
		for (let i = 0; i < argCount; i++) {
			const group = readBraceGroup(text, end);
			if (!group) break;
			args.push(group.value);
			end = group.end;
		}
		if (args.length !== argCount) {
			output += text.slice(at, end);
			cursor = end;
			continue;
		}
		output += build(args);
		cursor = end;
	}
}

function replaceScripts(text: string): string {
	let output = text.replace(/\^\{([^{}]*)\}/g, (_, body: string) => mapScript(body, SUPERSCRIPT, '^'));
	output = output.replace(/_\{([^{}]*)\}/g, (_, body: string) => mapScript(body, SUBSCRIPT, '_'));
	output = output.replace(/\^([^\s{}^_])/g, (_, body: string) => mapScript(body, SUPERSCRIPT, '^'));
	output = output.replace(/_([^\s{}^_])/g, (_, body: string) => mapScript(body, SUBSCRIPT, '_'));
	return output;
}

/** Convert a bare LaTeX math fragment (no delimiters) to terminal-readable Unicode. */
export function latexToUnicode(source: string): string {
	let text = source
		.replace(/\\left\s*/g, '')
		.replace(/\\right\s*/g, '')
		.replace(/\\(?:quad|qquad)\b/g, '  ')
		.replace(/\\[,;:!]/g, ' ')
		.replace(/\\ /g, ' ');

	for (const [command, mark] of Object.entries(ACCENTS)) {
		text = replaceGroups(text, command, ([body]) => `${latexToUnicode(body)}${mark}`, 1);
	}
	text = replaceGroups(text, 'frac', ([a, b]) => `(${latexToUnicode(a)})/(${latexToUnicode(b)})`, 2);
	text = replaceGroups(text, 'dfrac', ([a, b]) => `(${latexToUnicode(a)})/(${latexToUnicode(b)})`, 2);
	text = replaceGroups(text, 'tfrac', ([a, b]) => `(${latexToUnicode(a)})/(${latexToUnicode(b)})`, 2);
	text = replaceGroups(text, 'sqrt', ([body]) => `√(${latexToUnicode(body)})`, 1);
	for (const command of ['text', 'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathtt', 'operatorname']) {
		text = replaceGroups(text, command, ([body]) => latexToUnicode(body), 1);
	}
	for (const [letter, math] of Object.entries(BLACKBOARD)) {
		text = text.replace(new RegExp(`\\\\mathbb\\s*\\{?${letter}\\}?`, 'g'), math);
	}

	text = replaceScripts(text);
	for (const [command, symbol] of Object.entries(SYMBOLS)) {
		text = text.replace(new RegExp(`\\\\${command}\\b`, 'g'), symbol);
	}
	text = text.replace(/\\([A-Za-z]+)/g, '$1');
	text = text.replace(/[{}]/g, '').replace(/[ \t]+/g, ' ');
	return text.trim();
}

/** Convert math spans in prose while leaving fenced and inline code untouched. */
export function renderMathInText(source: string): string {
	if (!source.includes('$') && !source.includes('\\(') && !source.includes('\\[')) return source;
	const code: string[] = [];
	const protectedText = source
		.replace(/```[\s\S]*?```/g, (block) => `\u0001${code.push(block) - 1}\u0001`)
		.replace(/`[^`\n]*`/g, (span) => `\u0001${code.push(span) - 1}\u0001`);

	let text = protectedText
		.replace(/\$\$([\s\S]+?)\$\$/g, (_, body: string) => `\n\n  ${latexToUnicode(body)}\n\n`)
		.replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n\n  ${latexToUnicode(body)}\n\n`)
		.replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => latexToUnicode(body));

	text = text.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (match, body: string) => {
		const trimmed = body.trim();
		// Leave currency amounts like "$5" or "$1,200" alone.
		if (/^[\d.,]+$/.test(trimmed)) return match;
		return latexToUnicode(trimmed);
	});

	return text.replace(/\u0001(\d+)\u0001/g, (_, index: string) => code[Number(index)] ?? '');
}
