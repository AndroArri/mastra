import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { MastraBrowser } from '../mastra-browser.js';
import type { BrowserSSEEvent, ScrapingLogEntry } from '../types.js';

describe('MastraBrowser Integration Tests', () => {
  it('should launch session and navigate with mock innerBrowser', async () => {
    const mockInner = {
      goto: vi.fn().mockResolvedValue({ status: () => 200 }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const browser = new MastraBrowser({
      provider: 'stagehand',
      headless: true,
      innerBrowser: mockInner,
    });

    await browser.launch();
    const navResult = await browser.navigate('https://example.com');

    expect(mockInner.goto).toHaveBeenCalledWith('https://example.com');
    expect(navResult.url).toBe('https://example.com');
    expect(navResult.status).toBe(200);

    const logs = browser.getLogs({ action: 'navigate' });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]!.message).toContain('Navigating to https://example.com');

    await browser.close();
    expect(mockInner.close).toHaveBeenCalled();
  });

  it('should execute custom actions and log lifecycle events', async () => {
    const mockInner = {
      page: {
        click: vi.fn().mockResolvedValue(undefined),
      },
    };

    const browser = new MastraBrowser({ innerBrowser: mockInner });
    await browser.launch();

    const actionResult = await browser.executeAction('click-button', async b => {
      await b.page.click('#submit');
      return 'clicked';
    });

    expect(actionResult).toBe('clicked');
    expect(mockInner.page.click).toHaveBeenCalledWith('#submit');

    const logs = browser.getLogs({ action: 'click-button' });
    expect(logs.length).toBe(2); // start and completion logs
    expect(logs[1]!.message).toBe('Action completed: click-button');

    await browser.close();
  });

  it('should handle scraping / extraction tasks and expose logs to TUI', async () => {
    const mockInner = {
      extract: vi.fn().mockResolvedValue({ title: 'Test Page', links: ['https://link1.com'] }),
    };

    const browser = new MastraBrowser({ innerBrowser: mockInner });
    await browser.launch();

    const logListener = vi.fn();
    const unsubscribeLog = browser.onLog(logListener);

    const data = await browser.scrape('Extract page title and links');

    expect(mockInner.extract).toHaveBeenCalledWith('Extract page title and links');
    expect(data).toEqual({ title: 'Test Page', links: ['https://link1.com'] });

    expect(logListener).toHaveBeenCalled();
    const scrapingLogs = browser.getLogs({ action: 'scrape' });
    expect(scrapingLogs.length).toBe(2);
    expect(scrapingLogs[1]!.message).toContain('Scraping completed');

    unsubscribeLog();
    await browser.close();
  });

  it('should capture screenshot and save to file path', async () => {
    const tempDir = join(tmpdir(), `mastra-browser-test-${Date.now()}`);
    const screenshotPath = join(tempDir, 'screenshot.png');

    const browser = new MastraBrowser();
    await browser.launch();

    const shot = await browser.captureScreenshot({
      path: screenshotPath,
      format: 'data-url',
    });

    expect(shot.data).toContain('data:image/png;base64,');
    expect(shot.format).toBe('data-url');
    expect(existsSync(screenshotPath)).toBe(true);

    const fileContent = readFileSync(screenshotPath);
    expect(fileContent.length).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true, force: true });
    await browser.close();
  });

  it('should handle video recording start and stop lifecycle', async () => {
    const tempDir = join(tmpdir(), `mastra-video-test-${Date.now()}`);

    const browser = new MastraBrowser({
      recordVideo: true,
      videoDir: tempDir,
    });

    await browser.launch();
    // Simulate some work time
    await new Promise(r => setTimeout(r, 50));

    const videoResult = await browser.stopVideoRecording();

    expect(videoResult.recording).toBe(false);
    expect(videoResult.durationMs).toBeGreaterThanOrEqual(40);
    expect(videoResult.videoPath).toContain(tempDir);

    const logs = browser.getLogs({ action: 'video_recording_stop' });
    expect(logs.length).toBe(1);

    await browser.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should emit real-time SSE events on visual preview stream for Factory UI', async () => {
    const events: BrowserSSEEvent[] = [];

    const browser = new MastraBrowser({
      enablePreviewStream: true,
      previewIntervalMs: 50,
    });

    const unsubscribeSSE = browser.subscribeSSE(evt => {
      events.push(evt);
    });

    await browser.launch();
    await browser.navigate('https://example.com/stream-test');

    // Wait for stream timer ticks
    await new Promise(r => setTimeout(r, 150));

    expect(events.some(e => e.type === 'status' && e.data.status === 'connected')).toBe(true);
    expect(events.some(e => e.type === 'navigated')).toBe(true);
    expect(events.some(e => e.type === 'frame')).toBe(true);

    const frameEvent = events.find(e => e.type === 'frame');
    expect(frameEvent?.data.image).toContain('data:image/png;base64,');

    unsubscribeSSE();
    await browser.close();
  });

  it('should generate HTTP ReadableStream for SSE responses', async () => {
    const browser = new MastraBrowser();
    await browser.launch();

    const stream = browser.createSSEResponseStream();
    const reader = stream.getReader();

    // The stream immediately enqueues the initial status & frame
    const { value, done } = await reader.read();
    expect(done).toBe(false);

    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: status');
    expect(text).toContain('data: {');

    await reader.cancel();
    await browser.close();
  });
});
