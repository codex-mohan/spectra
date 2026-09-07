import { c } from '../theme.js';

const TITLE = [
	{
		letter: 'S',
		rows: ['███████', '██     ', '██     ', '███████', '     ██', '███████'],
	},
	{
		letter: 'P',
		rows: ['██████ ', '██   ██', '██   ██', '██████ ', '██     ', '██     '],
	},
	{
		letter: 'E',
		rows: ['███████', '██     ', '██     ', '██████ ', '██     ', '███████'],
	},
	{
		letter: 'C',
		rows: ['███████', '██     ', '██     ', '██     ', '██     ', '███████'],
	},
	{
		letter: 'T',
		rows: ['███████', '   ██  ', '   ██  ', '   ██  ', '   ██  ', '   ██  '],
	},
	{
		letter: 'R',
		rows: ['██████ ', '██   ██', '██   ██', '██████ ', '██  ██ ', '██   ██'],
	},
	{
		letter: 'A',
		rows: ['  ███  ', ' ██ ██ ', '██   ██', '███████', '██   ██', '██   ██'],
	},
] as const;

// A restrained left-to-right gradient between Spectra's cyan accent and blue.
const TITLE_COLORS = [c.accent, '#70C3D5', '#72BDDB', '#74B8E0', '#76B3E5', '#78ADEB', c.blue] as const;

/** Flat, terminal-native Spectra wordmark without outline or shadow glyphs. */
export function HomeTitle() {
	return (
		<box flexDirection="row" height={6}>
			{TITLE.map(({ letter, rows }, index) => (
				<box key={letter} width={index === TITLE.length - 1 ? 7 : 8} height={6}>
					<text fg={TITLE_COLORS[index]}>{rows.join('\n')}</text>
				</box>
			))}
		</box>
	);
}
