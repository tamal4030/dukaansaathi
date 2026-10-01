import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Tests must never touch the network. `fetch` is stubbed to fail fast, which is
 * also the realistic "backend not reachable" path. Tests that need data spy on
 * the specific api.* method they use, so fetch is never reached in those cases.
 *
 * No module mocking is used here on purpose: a second module instance would
 * make spies invisible to the components under test.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Network access is disabled in tests.'))),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!('scrollIntoView' in Element.prototype)) {
  // jsdom does not implement scrollIntoView. The cast goes through `unknown`
  // because the `in`-operator check narrows the prototype to `never`.
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
}
