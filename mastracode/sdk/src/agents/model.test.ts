import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it, vi } from 'vitest';
import { getDynamicModel, resolveModelWithFallback } from './model.js';

describe('getDynamicModel error branches', () => {
  it('points at the missing controller context when the run has no session request context at all', () => {
    const requestContext = new RequestContext();
    expect(() => getDynamicModel({ requestContext })).toThrow(
      'No model available: this run started without a controller session context, so no model selection could be resolved.',
    );
  });

  it('keeps the /models guidance when a controller context exists but has no model selected', () => {
    const requestContext = new RequestContext();
    requestContext.set('controller', { session: { modelId: '' } });
    expect(() => getDynamicModel({ requestContext })).toThrow(
      'No model selected. Use /models to select a model first.',
    );
  });
});

describe('resolveModelWithFallback', () => {
  it('attempts fallback models when the primary fails', () => {
    const onFallback = vi.fn();
    expect(() =>
      resolveModelWithFallback('invalid-provider/model', {
        fallbackModelIds: ['another-invalid/model'],
        onFallback,
      }),
    ).toThrow();
    expect(onFallback).toHaveBeenCalledWith('invalid-provider/model', 'another-invalid/model', expect.any(Error));
  });
});

