// Vitest runs in jsdom, which has no real IndexedDB - fake-indexeddb provides
// a spec-compliant in-memory implementation so Dexie (used by the offline
// sync engine) works exactly as it would in a real browser.
import 'fake-indexeddb/auto';

// Adds matchers like toBeInTheDocument(), toHaveClass(), etc. for component tests.
import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmounts rendered components after each test so one test's DOM never
// leaks into the next.
afterEach(() => {
  cleanup();
});
