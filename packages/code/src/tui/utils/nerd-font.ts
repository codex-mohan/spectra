/**
 * Prefer Nerd Font glyphs. Set SPECTRA_NERD_FONT=0/false or NO_NERD_FONT=1
 * to force plain fallbacks in terminals without Nerd Font coverage.
 */
export function hasNerdFont(): boolean {
	const forced = process.env.SPECTRA_NERD_FONT;
	if (forced != null) return forced !== '0' && forced.toLowerCase() !== 'false';
	return process.env.NO_NERD_FONT !== '1';
}
