import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { AcpEventBus, SSEParser } from '../acp/event-bus.js';
import { AcpBaseClient } from '../acp/client.js';

describe('ACP Event Bus & Base Client Integration Tests', () => {
  describe('SSEParser', () => {
    it('parses single SSE block with event and data', () => {
      const parser = new SSEParser();
      const chunks = parser.parseChunk('event: text_delta\ndata: {"sessionId":"s1","delta":"Hello"}\n\n');

      assert.deepStrictEqual(chunks, [
        {
          id: undefined,
          event: 'text_delta',
          data: '{"sessionId":"s1","delta":"Hello"}',
          retry: undefined,
        },
      ]);
    });

    it('handles chunk buffering across broken SSE lines', () => {
      const parser = new SSEParser();
      let chunks = parser.parseChunk('event: progress\ndata: {"type":"tool');
      assert.deepStrictEqual(chunks, []);

      chunks = parser.parseChunk('_start","toolName":"edit_file"}\n\n');
      assert.deepStrictEqual(chunks, [
        {
          id: undefined,
          event: 'progress',
          data: '{"type":"tool_start","toolName":"edit_file"}',
          retry: undefined,
        },
      ]);
    });

    it('flushes uncompleted buffers', () => {
      const parser = new SSEParser();
      parser.parseChunk('data: incomplete string');
      const flushed = parser.flush();
      assert.deepStrictEqual(flushed, [
        {
          id: undefined,
          event: undefined,
          data: 'incomplete string',
          retry: undefined,
        },
      ]);
    });
  });

  describe('Real-time Token Delta Streaming', () => {
    it('emits text_delta events when emitTextDelta is called', () => {
      const bus = new AcpEventBus();
      const client = new AcpBaseClient({ eventBus: bus });
      const received: unknown[] = [];

      client.onTextDelta(event => {
        received.push(event);
      });

      bus.emitTextDelta('session-1', 'Hello ', 'Hello ');
      bus.emitTextDelta('session-1', 'world!', 'Hello world!');

      assert.strictEqual(received.length, 2);
      assert.deepStrictEqual(received[0], {
        sessionId: 'session-1',
        delta: 'Hello ',
        fullText: 'Hello ',
      });
      assert.deepStrictEqual(received[1], {
        sessionId: 'session-1',
        delta: 'world!',
        fullText: 'Hello world!',
      });
    });

    it('ingests ACP SessionNotification agent_message_chunk into text_delta', () => {
      const bus = new AcpEventBus();
      const client = new AcpBaseClient({ eventBus: bus });
      const received: unknown[] = [];

      client.onTextDelta(event => {
        received.push(event);
      });

      const notification: SessionNotification = {
        sessionId: 'session-123',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Streaming token chunk' },
        },
      };

      client.handleSessionNotification(notification);

      assert.strictEqual(received.length, 1);
      assert.deepStrictEqual(received[0], {
        sessionId: 'session-123',
        delta: 'Streaming token chunk',
        fullText: undefined,
      });
    });
  });

  describe('Real-time Progress & Tool Call Events', () => {
    it('emits progress and tool_call events for tool lifecycle', () => {
      const bus = new AcpEventBus();
      const client = new AcpBaseClient({ eventBus: bus });
      const progressReceived: unknown[] = [];
      const toolCallReceived: unknown[] = [];

      client.onProgress(event => progressReceived.push(event));
      client.onToolCall(event => toolCallReceived.push(event));

      const notificationStart: SessionNotification = {
        sessionId: 'session-456',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-1',
          title: 'read_file',
          kind: 'read',
          rawInput: '{"path":"index.ts"}',
          status: 'in_progress',
        },
      };

      client.handleSessionNotification(notificationStart);

      assert.deepStrictEqual(toolCallReceived[0], {
        sessionId: 'session-456',
        toolCallId: 'tc-1',
        title: 'read_file',
        kind: 'read',
        rawInput: '{"path":"index.ts"}',
        status: 'in_progress',
      });

      assert.deepStrictEqual(progressReceived[0], {
        sessionId: 'session-456',
        type: 'tool_start',
        toolName: 'read_file',
        toolCallId: 'tc-1',
        status: 'in_progress',
      });

      const notificationEnd: SessionNotification = {
        sessionId: 'session-456',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-1',
          rawOutput: 'file contents',
          status: 'completed',
        },
      };

      client.handleSessionNotification(notificationEnd);

      assert.deepStrictEqual(toolCallReceived[1], {
        sessionId: 'session-456',
        toolCallId: 'tc-1',
        title: '',
        rawOutput: 'file contents',
        status: 'completed',
      });
    });
  });

  describe('Interactive Permissions Lifecycle', () => {
    it('tracks pending permissions and resolves on approval', async () => {
      const bus = new AcpEventBus();
      const client = new AcpBaseClient({ eventBus: bus });
      const permReceived: unknown[] = [];

      client.onPermissionRequest(event => permReceived.push(event));

      const promise = client.eventBus.requestPermission({
        sessionId: 'sess-1',
        toolCallId: 'tc-exec',
        title: 'execute_command',
        rawInput: 'rm -rf /tmp/test',
        options: [
          { optionId: 'approve', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      });

      assert.strictEqual(permReceived.length, 1);
      const pendingPerms = client.getPendingPermissions();
      assert.strictEqual(pendingPerms.length, 1);
      const permId = pendingPerms[0].id;
      assert.strictEqual(pendingPerms[0].title, 'execute_command');

      // Approve permission
      const approved = client.approvePermission(permId, 'approve');
      assert.strictEqual(approved, true);

      const result = await promise;
      assert.strictEqual(result, 'approve');
      assert.strictEqual(client.getPendingPermissions().length, 0);
    });

    it('rejects pending permissions with decline or error', async () => {
      const bus = new AcpEventBus();
      const client = new AcpBaseClient({ eventBus: bus });
      const permReceived: unknown[] = [];

      client.onPermissionRequest(event => permReceived.push(event));

      const promise = client.eventBus.requestPermission({
        sessionId: 'sess-2',
        toolCallId: 'tc-del',
        title: 'delete_database',
      });

      const pendingPerms = client.getPendingPermissions();
      assert.strictEqual(pendingPerms.length, 1);

      // Reject permission
      const rejected = client.rejectPermission(pendingPerms[0].id);
      assert.strictEqual(rejected, true);

      const result = await promise;
      assert.strictEqual(result, 'decline');
      assert.strictEqual(client.getPendingPermissions().length, 0);
    });
  });

  describe('SSE Stream Integration', () => {
    it('ingests SSE text_delta and permission_request chunks', async () => {
      const bus = new AcpEventBus();
      const client = new AcpBaseClient({ eventBus: bus });
      const deltaReceived: unknown[] = [];
      const permReceived: unknown[] = [];

      client.onTextDelta(event => deltaReceived.push(event));
      client.onPermissionRequest(event => permReceived.push(event));

      const sseContent = [
        'event: text_delta\n',
        'data: {"sessionId":"sess-sse","delta":"First chunk "}\n\n',
        'event: permission_request\n',
        'data: {"id":"p-100","sessionId":"sess-sse","toolCallId":"tc-1","title":"destructive_tool"}\n\n',
      ];

      await client.processSSEStream(sseContent, 'sess-sse');

      assert.deepStrictEqual(deltaReceived[0], {
        sessionId: 'sess-sse',
        delta: 'First chunk ',
        fullText: undefined,
      });

      assert.strictEqual(permReceived.length, 1);
      assert.strictEqual((permReceived[0] as any).id, 'p-100');
      assert.strictEqual((permReceived[0] as any).title, 'destructive_tool');

      assert.strictEqual(client.getPendingPermissions().length, 1);
    });
  });
});
