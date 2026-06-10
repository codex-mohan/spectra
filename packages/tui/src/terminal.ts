import { setKittyProtocolActive } from './keys.js';
import { StdinBuffer } from './stdin-buffer.js';

export interface Terminal {
	start(onInput: (data: string) => void, onResize: () => void): void;
	stop(): void;
	write(data: string): void;
	get columns(): number;
	get rows(): number;
	get kittyProtocolActive(): boolean;
	moveBy(lines: number): void;
	hideCursor(): void;
	showCursor(): void;
	clearLine(): void;
	clearFromCursor(): void;
	clearScreen(): void;
	setTitle(title: string): void;
}

export class ProcessTerminal implements Terminal {
	private wasRaw = false;
	private inputHandler?: (data: string) => void;
	private resizeHandler?: () => void;
	private _kittyProtocolActive = false;
	private _modifyOtherKeysActive = false;
	private stdinBuffer?: StdinBuffer;
	private stdinDataHandler?: (data: string) => void;

	get kittyProtocolActive(): boolean {
		return this._kittyProtocolActive;
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inputHandler = onInput;
		this.resizeHandler = onResize;

		this.wasRaw = process.stdin.isRaw || false;
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(true);
		}
		process.stdin.setEncoding('utf8');
		process.stdin.resume();

		process.stdout.write('\x1b[?2004h'); // Enable bracketed paste

		process.stdout.on('resize', this.resizeHandler);

		if (process.platform !== 'win32') {
			process.kill(process.pid, 'SIGWINCH');
		}

		this.enableWindowsVTInput();
		this.queryAndEnableKittyProtocol();
	}

	private setupStdinBuffer(): void {
		this.stdinBuffer = new StdinBuffer({ timeout: 10 });

		const kittyResponsePattern = /^\x1b\[\?(\d+)u$/;

		this.stdinBuffer.on('data', (sequence) => {
			if (!this._kittyProtocolActive) {
				const match = sequence.match(kittyResponsePattern);
				if (match) {
					this._kittyProtocolActive = true;
					setKittyProtocolActive(true);
					process.stdout.write('\x1b[>7u');
					return;
				}
			}
			if (this.inputHandler) {
				this.inputHandler(sequence);
			}
		});

		this.stdinBuffer.on('paste', (content) => {
			if (this.inputHandler) {
				this.inputHandler(`\x1b[200~${content}\x1b[201~`);
			}
		});

		this.stdinDataHandler = (data: string) => {
			this.stdinBuffer!.process(data);
		};
	}

	private queryAndEnableKittyProtocol(): void {
		this.setupStdinBuffer();
		process.stdin.on('data', this.stdinDataHandler!);
		process.stdout.write('\x1b[?u');
		setTimeout(() => {
			if (!this._kittyProtocolActive && !this._modifyOtherKeysActive) {
				process.stdout.write('\x1b[>4;2m');
				this._modifyOtherKeysActive = true;
			}
		}, 150);
	}

	private enableWindowsVTInput(): void {
		if (process.platform !== 'win32') return;
		try {
			const koffi = require('koffi');
			const k32 = koffi.load('kernel32.dll');
			const GetStdHandle = k32.func('void* __stdcall GetStdHandle(int)');
			const GetConsoleMode = k32.func('bool __stdcall GetConsoleMode(void*, _Out_ uint32_t*)');
			const SetConsoleMode = k32.func('bool __stdcall SetConsoleMode(void*, uint32_t)');

			const STD_INPUT_HANDLE = -10;
			const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;
			const handle = GetStdHandle(STD_INPUT_HANDLE);
			const mode = new Uint32Array(1);
			GetConsoleMode(handle, mode);
			SetConsoleMode(handle, mode[0]! | ENABLE_VIRTUAL_TERMINAL_INPUT);
		} catch {
			// koffi not available
		}
	}

	stop(): void {
		process.stdout.write('\x1b[?2004l');

		if (this._kittyProtocolActive) {
			process.stdout.write('\x1b[<u');
			this._kittyProtocolActive = false;
			setKittyProtocolActive(false);
		}
		if (this._modifyOtherKeysActive) {
			process.stdout.write('\x1b[>4;0m');
			this._modifyOtherKeysActive = false;
		}

		if (this.stdinBuffer) {
			this.stdinBuffer.destroy();
			this.stdinBuffer = undefined;
		}

		if (this.stdinDataHandler) {
			process.stdin.removeListener('data', this.stdinDataHandler);
			this.stdinDataHandler = undefined;
		}
		this.inputHandler = undefined;
		if (this.resizeHandler) {
			process.stdout.removeListener('resize', this.resizeHandler);
			this.resizeHandler = undefined;
		}

		process.stdin.pause();

		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(this.wasRaw);
		}
	}

	write(data: string): void {
		process.stdout.write(data);
	}

	get columns(): number {
		return process.stdout.columns || 80;
	}

	get rows(): number {
		return process.stdout.rows || 24;
	}

	moveBy(lines: number): void {
		if (lines > 0) {
			process.stdout.write(`\x1b[${lines}B`);
		} else if (lines < 0) {
			process.stdout.write(`\x1b[${-lines}A`);
		}
	}

	hideCursor(): void {
		process.stdout.write('\x1b[?25l');
	}

	showCursor(): void {
		process.stdout.write('\x1b[?25h');
	}

	clearLine(): void {
		process.stdout.write('\x1b[K');
	}

	clearFromCursor(): void {
		process.stdout.write('\x1b[J');
	}

	clearScreen(): void {
		process.stdout.write('\x1b[2J\x1b[H');
	}

	setTitle(title: string): void {
		process.stdout.write(`\x1b]0;${title}\x07`);
	}
}
