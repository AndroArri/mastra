import { describe, expect, it } from 'vitest';
import {
  defaultMockProject,
  defaultMockWorkItem,
  setupFactoryAcpMocks,
  setupFactoryRestMocks,
  setupFactorySseMock,
} from './msw-harness';

describe('Factory UI MSW Harness & Deterministic Network Isolation', () => {
  it('mocks REST endpoints for auth, models, features, and projects', async () => {
    setupFactoryRestMocks({
      projects: [{ id: 'proj-msw-100', name: 'MSW Test Project', status: 'active' }],
      models: ['openai/gpt-5.4-mini'],
      features: { knowledge: true },
      authenticated: true,
    });

    // 1. Auth check
    const authRes = await fetch('http://localhost/auth/me');
    expect(authRes.status).toBe(200);
    const authData = await authRes.json();
    expect(authData.email).toBe('test@example.com');

    // 2. Config models check
    const modelsRes = await fetch('http://localhost/web/config/models');
    expect(modelsRes.status).toBe(200);
    const modelsData = await modelsRes.json();
    expect(modelsData.models).toEqual([{ id: 'openai/gpt-5.4-mini', name: 'openai/gpt-5.4-mini', provider: 'openai' }]);

    // 3. Projects list check
    const projRes = await fetch('http://localhost/web/factory/projects');
    expect(projRes.status).toBe(200);
    const projData = await projRes.json();
    expect(projData.projects[0].id).toBe('proj-msw-100');
  });

  it('mocks real-time SSE stream events deterministically', async () => {
    const sseEvents = [
      { event: 'status', data: { state: 'running' } },
      { event: 'delta', data: { text: 'Hello MSW SSE' } },
      { event: 'done', data: { completed: true } },
    ];

    setupFactorySseMock('*/api/test-sse-stream', sseEvents);

    const sseRes = await fetch('http://localhost/api/test-sse-stream');
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('Content-Type')).toBe('text/event-stream');

    const text = await sseRes.text();
    expect(text).toContain('event: status');
    expect(text).toContain('event: delta');
    expect(text).toContain('data: {"text":"Hello MSW SSE"}');
  });

  it('mocks ACP Agent Client Protocol session creation and notifications', async () => {
    const controllerId = 'ctrl-msw-test';
    setupFactoryAcpMocks({
      controllerId,
      sessionId: 'sess-msw-456',
      notifications: [
        {
          method: 'session/notification',
          params: { type: 'agent_message_chunk', delta: 'ACP Stream Token' },
        },
      ],
    });

    // Create session
    const sessRes = await fetch(`http://localhost/api/agent-controller/${controllerId}/session`, {
      method: 'POST',
    });
    expect(sessRes.status).toBe(200);
    const sessData = await sessRes.json();
    expect(sessData.sessionId).toBe('sess-msw-456');

    // Events stream
    const eventsRes = await fetch(`http://localhost/api/agent-controller/${controllerId}/events`);
    expect(eventsRes.status).toBe(200);
    const streamText = await eventsRes.text();
    expect(streamText).toContain('ACP Stream Token');

    // Tool permission resolve
    const permRes = await fetch(`http://localhost/api/agent-controller/${controllerId}/permissions/resolve`, {
      method: 'POST',
    });
    expect(permRes.status).toBe(200);
    const permData = await permRes.json();
    expect(permData.resolved).toBe(true);
  });
});
