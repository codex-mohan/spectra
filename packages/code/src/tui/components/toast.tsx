import { useState, useEffect, useCallback } from 'react';
import { c } from '../theme.js';

export interface Toast {
	id: string;
	message: string;
	variant: 'info' | 'success' | 'warn' | 'error';
}

let toastListeners: ((toast: Toast) => void)[] = [];

export function showToast(message: string, variant: Toast['variant'] = 'info') {
	const toast: Toast = { id: Math.random().toString(36).slice(2, 9), message, variant };
	for (const fn of toastListeners) fn(toast);
}

export function ToastContainer() {
	const [toasts, setToasts] = useState<Toast[]>([]);

	useEffect(() => {
		const handler = (toast: Toast) => {
			setToasts((prev) => [...prev, toast]);
			setTimeout(() => {
				setToasts((prev) => prev.filter((t) => t.id !== toast.id));
			}, 3000);
		};
		toastListeners.push(handler);
		return () => {
			toastListeners = toastListeners.filter((h) => h !== handler);
		};
	}, []);

	if (toasts.length === 0) return null;

	const colors: Record<string, string> = {
		info: c.info,
		success: c.success,
		warn: c.warn,
		error: c.error,
	};

	return (
		<box position="absolute" right={2} bottom={2} flexDirection="column" gap={1} zIndex={9999}>
			{toasts.map((t) => (
				<box key={t.id} backgroundColor={c.bgBar} paddingX={2} paddingY={1}>
					<text fg={colors[t.variant]}>{t.message}</text>
				</box>
			))}
		</box>
	);
}
