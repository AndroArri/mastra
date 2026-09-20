import { http, HttpResponse } from 'msw';
import { server } from '../../../e2e/ui/msw-server';

/**
 * MSW Test Harness for Factory UI.
 * Provides deterministic mock helpers for:
 * - REST endpoints (Auth, Projects, Config, Models, Work Items, Decisions, Attention)
 * - SSE Event Streams (Real-time agent execution deltas, status, logs)
 * - ACP Protocol Streams (Session notifications, tool approvals, permission requests)
 */

export interface MockProject {
  id: string;
  name: string;
  repository?: string;
  status?: string;
  [key: string]: unknown;
}

export interface MockWorkItem {
  id: string;
  title: string;
  status: string;
  projectId: string;
  [key: string]: unknown;
}

export interface MockSseEvent {
  event: string;
  data: Record<string, unknown> | string;
}

export const defaultMockProject: MockProject = {
  id: 'proj-default-001',
  name: 'Default Test Project',
  repository: 'org/repo-default',
  status: 'active',
};

export const defaultMockWorkItem: MockWorkItem = {
  id: 'wi-default-001',
  title: 'Default Work Item',
  status: 'open',
  projectId: 'proj-default-001',
};

/**
 * Configures REST Endpoint handlers on the MSW server.
 */
export function setupFactoryRestMocks(options?: {
  projects?: MockProject[];
  workItems?: MockWorkItem[];
  authenticated?: boolean;
  models?: string[];
  features?: Record<string, boolean>;
}) {
  const projects = options?.projects ?? [defaultMockProject];
  const workItems = options?.workItems ?? [defaultMockWorkItem];
  const authenticated = options?.authenticated ?? true;
  const models = options?.models ?? ['openai/gpt-5.4-mini', 'anthropic/claude-3-7-sonnet'];
  const features = options?.features ?? { knowledge: true, gitops: true };

  server.use(
    // Auth ME
    http.get('*/auth/me', () => {
      if (!authenticated) return HttpResponse.json(null, { status: 401 });
      return HttpResponse.json({
        id: 'user-001',
        email: 'test@example.com',
        name: 'Test User',
      });
    }),

    // Config Models
    http.get('*/web/config/models', () => {
      return HttpResponse.json({
        models: models.map(id => ({ id, name: id, provider: id.split('/')[0] })),
      });
    }),

    // Config Features
    http.get('*/web/config/features', () => {
      return HttpResponse.json(features);
    }),

    // Projects list
    http.get('*/web/factory/projects', () => {
      return HttpResponse.json({ projects });
    }),

    // Single Project detail
    http.get('*/web/factory/projects/:id', ({ params }) => {
      const proj = projects.find(p => p.id === params.id) ?? { ...defaultMockProject, id: params.id as string };
      return HttpResponse.json({ project: proj });
    }),

    // Work items
    http.get('*/web/factory/projects/:id/work-items', ({ params }) => {
      const items = workItems.filter(w => w.projectId === params.id || !w.projectId);
      return HttpResponse.json({ workItems: items.length > 0 ? items : workItems });
    }),

    // Decisions
    http.get('*/web/factory/projects/:id/decisions', () => {
      return HttpResponse.json({ decisions: [] });
    }),

    // Attention
    http.get('*/web/factory/projects/:id/attention', () => {
      return HttpResponse.json({
        items: [],
        openCount: 0,
        approvalCount: 0,
        badgeCount: 0,
        unreadCount: 0,
        hasMore: false,
      });
    }),
  );
}

/**
 * Configures SSE Event Stream Mocking.
 * Formats events into valid text/event-stream chunks.
 */
export function createMockSseResponse(events: MockSseEvent[]): HttpResponse {
  const streamEncoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const ev of events) {
        const payload = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data);
        const chunk = `event: ${ev.event}\ndata: ${payload}\n\n`;
        controller.enqueue(streamEncoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new HttpResponse(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Registers an SSE Stream Handler for an endpoint.
 */
export function setupFactorySseMock(endpointPattern: string, events: MockSseEvent[]) {
  server.use(
    http.get(endpointPattern, () => {
      return createMockSseResponse(events);
    }),
  );
}

/**
 * Configures ACP (Agent Client Protocol) stream and RPC mocks.
 */
export function setupFactoryAcpMocks(options?: {
  controllerId?: string;
  sessionId?: string;
  notifications?: Array<{ method: string; params: Record<string, unknown> }>;
}) {
  const controllerId = options?.controllerId ?? 'ctrl-001';
  const notifications = options?.notifications ?? [
    {
      method: 'session/notification',
      params: {
        type: 'agent_message_chunk',
        delta: 'Deterministic ACP Response Token',
      },
    },
  ];

  const sseEvents: MockSseEvent[] = notifications.map(n => ({
    event: 'acp-event',
    data: n,
  }));

  server.use(
    // ACP session initialization
    http.post(`*/api/agent-controller/${controllerId}/session`, () => {
      return HttpResponse.json({
        sessionId: options?.sessionId ?? 'acp-sess-001',
        status: 'connected',
      });
    }),

    // ACP event stream
    http.get(`*/api/agent-controller/${controllerId}/events`, () => {
      return createMockSseResponse(sseEvents);
    }),

    // ACP tool approval decision
    http.post(`*/api/agent-controller/${controllerId}/permissions/resolve`, () => {
      return HttpResponse.json({ resolved: true });
    }),
  );
}

export { server };
