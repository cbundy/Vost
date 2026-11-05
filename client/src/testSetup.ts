/** Every test file starts with an empty, always-saving settings store, so no test sends a request to a server. */
import { seedStorageForTest } from './lib/storage';

seedStorageForTest();
