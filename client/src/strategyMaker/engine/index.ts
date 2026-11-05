/** The strategy maker's search engine. Pure: no DOM, no React; runs in a worker and in Vitest. */
export { runSearch as searchStrategies, DEFAULT_SPACE } from './search';
export * from './types';
