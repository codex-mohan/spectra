import { describe, expect, it } from 'vitest';
import { latexToUnicode, renderMathInText } from '../tui/utils/math.js';

describe('LaTeX to Unicode', () => {
	it('converts fractions, roots, symbols, and scripts', () => {
		expect(latexToUnicode('\\frac{a}{b}')).toBe('(a)/(b)');
		expect(latexToUnicode('\\sqrt{x^2 + y^2}')).toBe('√(x² + y²)');
		expect(latexToUnicode('\\alpha + \\beta^2')).toBe('α + β²');
		expect(latexToUnicode('\\mathbb{R}')).toBe('ℝ');
	});

	it('converts display-style sums with subscripts and superscripts', () => {
		expect(latexToUnicode('\\sum_{i=1}^{n} i')).toBe('∑ᵢ₌₁ⁿ i');
	});
});

describe('math spans in prose', () => {
	it('converts inline math and leaves currency alone', () => {
		expect(renderMathInText('The value is $x^2$ here.')).toBe('The value is x² here.');
		expect(renderMathInText('$5 and $10')).toBe('$5 and $10');
	});

	it('converts delimiter forms and display blocks', () => {
		expect(renderMathInText('Use \\(a+b\\) please.')).toBe('Use a+b please.');
		expect(renderMathInText('$$\\sum_{i=1}^{n} i$$')).toBe('\n\n  ∑ᵢ₌₁ⁿ i\n\n');
	});

	it('does not touch fenced or inline code', () => {
		const input = '```\n$x^2$\n```\nand `$y$`';
		expect(renderMathInText(input)).toBe(input);
	});
});
