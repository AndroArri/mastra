import { describe, expect, it } from 'vitest';
import { MastraBrowser } from '../index.js';

describe('Browser Module Exports', () => {
  it('should export MastraBrowser from browser index', () => {
    expect(MastraBrowser).toBeDefined();
    expect(typeof MastraBrowser).toBe('function');

    const instance = new MastraBrowser();
    expect(instance).toBeInstanceOf(MastraBrowser);
  });
});
