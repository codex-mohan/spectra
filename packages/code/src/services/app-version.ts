import packageMetadata from '../../package.json' with { type: 'json' };

interface PackageMetadata {
	version?: unknown;
}

const metadata = packageMetadata as PackageMetadata;
if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
	throw new Error('Spectra Code package version is unavailable');
}

/** Runtime package version, imported from this package's manifest. */
export const APP_VERSION = metadata.version;

export const APP_USER_AGENT = `spectra-code/${APP_VERSION}`;
