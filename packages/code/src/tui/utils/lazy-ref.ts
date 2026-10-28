import { useRef, type MutableRefObject } from 'react';

/**
 * `useRef(expensive())` evaluates its argument on every render. This helper
 * runs the factory once and keeps the resulting ref identity.
 */
export function useLazyRef<T>(factory: () => T): MutableRefObject<T> {
	const ref = useRef<T | null>(null);
	if (ref.current === null) ref.current = factory();
	return ref as MutableRefObject<T>;
}
