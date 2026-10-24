/** Project-level constants shown in the UI. */

// The version lives in package.json only (a named import is tree-shaken to this field).
import { version } from '../../../package.json';

export const APP_NAME = 'Vost';
export const APP_VERSION: string = version;
export const APP_TAGLINE = 'Self-hosted, open-source charts & backtesting';

/** The repository's GitHub URL, used by the top bar link. */
export const PROVIDER_GITHUB_URL = 'https://github.com/cbundy/Vost';
