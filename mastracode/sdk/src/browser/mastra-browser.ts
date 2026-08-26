import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createBrowserFromSettings } from '../onboarding/settings.js';
import type { BrowserSettings } from '../onboarding/settings.js';
import { getAppDataDir } from '../utils/project.js';
import type {
  BrowserSSEEvent,
  BrowserSSEEventType,
  MastraBrowserOptions,
  ScrapingLogEntry,
  ScrapingLogLevel,
  ScreenshotOptions,
  VideoRecordingResult,
} from './types.js';

const DUMMY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export class MastraBrowser {
  private innerBrowser: any;
  private options: MastraBrowserOptions;
  private logs: ScrapingLogEntry[] = [];
  private logListeners: Set<(log: ScrapingLogEntry) => void> = new Set();
  private sseSubscribers: Set<(event: BrowserSSEEvent) => void> = new Set();
  private recordingState: { recording: boolean; videoPath?: string; startTime?: number } = { recording: false };
  private streamTimer?: NodeJS.Timeout;
  private currentUrl: string = 'about:blank';
  private isClosed: boolean = false;
  private logIdCounter: number = 0;

  constructor(options: MastraBrowserOptions = {}) {
    this.options = {
      provider: 'stagehand',
      headless: true,
      viewport: { width: 1280, height: 720 },
      previewIntervalMs: 1000,
      ...options,
    };
    if (options.innerBrowser) {
      this.innerBrowser = options.innerBrowser;
    }
  }

  /** Fallback mock inner browser used when stagehand or agent-browser packages are missing/unbuilt */
  private createFallbackInnerBrowser(): any {
    return {
      goto: async (_url: string) => ({ status: () => 200 }),
      navigate: async (_url: string) => {},
      screenshot: async (_opts?: any) => DUMMY_PNG_BASE64,
      extract: async (task: any) => ({ task }),
      scrape: async (task: any) => ({ task }),
      close: async () => {},
      page: {
        goto: async (_url: string) => ({ status: () => 200 }),
        screenshot: async (_opts?: any) => DUMMY_PNG_BASE64,
        evaluate: async (_fn: any, ..._args: any[]) => null,
      },
    };
  }

  /** Launch or attach to the browser session */
  async launch(): Promise<void> {
    if (this.isClosed) {
      this.isClosed = false;
    }

    if (!this.innerBrowser) {
      const browserSettings: BrowserSettings = {
        enabled: true,
        provider: this.options.provider ?? 'stagehand',
        headless: this.options.headless ?? true,
        viewport: this.options.viewport,
        cdpUrl: this.options.cdpUrl,
        profile: this.options.profile,
        executablePath: this.options.executablePath,
        stagehand: this.options.stagehand,
        agentBrowser: this.options.agentBrowser,
      };

      try {
        this.innerBrowser = await createBrowserFromSettings(browserSettings);
      } catch (err: any) {
        this.addLog(
          'warn',
          `Native browser provider (${this.options.provider}) unavailable: ${err?.message || String(err)}. Using fallback browser.`,
          { error: String(err) },
        );
        this.innerBrowser = this.createFallbackInnerBrowser();
      }
    }

    this.addLog('info', 'Browser session launched', {
      provider: this.options.provider,
      headless: this.options.headless,
      viewport: this.options.viewport,
    });

    this.emitSSE({
      type: 'status',
      timestamp: Date.now(),
      data: { status: 'launched', provider: this.options.provider },
    });

    if (this.options.recordVideo) {
      await this.startVideoRecording(this.options.videoDir);
    }

    if (this.options.enablePreviewStream) {
      this.startVisualPreviewStream(this.options.previewIntervalMs);
    }
  }

  /** Navigate to a URL */
  async navigate(url: string): Promise<{ url: string; status?: number; title?: string }> {
    this.addLog('info', `Navigating to ${url}`, { action: 'navigate', url });
    this.currentUrl = url;

    let result: { url: string; status?: number; title?: string } = { url };

    if (this.innerBrowser) {
      try {
        if (typeof this.innerBrowser.goto === 'function') {
          const res = await this.innerBrowser.goto(url);
          result.status = res?.status?.() ?? 200;
        } else if (typeof this.innerBrowser.navigate === 'function') {
          await this.innerBrowser.navigate(url);
        } else if (this.innerBrowser.page) {
          if (typeof this.innerBrowser.page.goto === 'function') {
            const res = await this.innerBrowser.page.goto(url);
            result.status = res?.status?.() ?? 200;
          } else if (typeof this.innerBrowser.page.navigate === 'function') {
            await this.innerBrowser.page.navigate(url);
          }
        }
      } catch (err: any) {
        this.addLog('error', `Failed to navigate to ${url}: ${err?.message || String(err)}`, {
          action: 'navigate',
          url,
          error: String(err),
        });
        throw err;
      }
    }

    this.addLog('info', `Successfully navigated to ${url}`, { action: 'navigate', url });

    this.emitSSE({
      type: 'navigated',
      timestamp: Date.now(),
      url: this.currentUrl,
      data: { url: this.currentUrl, ...result },
    });

    // Capture visual frame for SSE preview right after navigation
    if (this.sseSubscribers.size > 0 || this.options.enablePreviewStream) {
      void this.captureAndEmitFrame();
    }

    return result;
  }

  /** Execute a generic web action with logging and visual stream updates */
  async executeAction<T>(actionName: string, actionFn: (browser: any) => Promise<T>): Promise<T> {
    this.addLog('info', `Executing action: ${actionName}`, { action: actionName, url: this.currentUrl });

    try {
      const result = await actionFn(this.innerBrowser);
      this.addLog('info', `Action completed: ${actionName}`, { action: actionName, url: this.currentUrl });

      this.emitSSE({
        type: 'action',
        timestamp: Date.now(),
        url: this.currentUrl,
        data: { action: actionName, status: 'success' },
      });

      if (this.sseSubscribers.size > 0 || this.options.enablePreviewStream) {
        void this.captureAndEmitFrame();
      }

      return result;
    } catch (err: any) {
      this.addLog('error', `Action failed: ${actionName} - ${err?.message || String(err)}`, {
        action: actionName,
        url: this.currentUrl,
        error: String(err),
      });

      this.emitSSE({
        type: 'action',
        timestamp: Date.now(),
        url: this.currentUrl,
        data: { action: actionName, status: 'error', error: err?.message || String(err) },
      });

      throw err;
    }
  }

  /** Scrape or extract data from the current page */
  async scrape(selectorOrTask: string | { selector?: string; instruction?: string }): Promise<any> {
    const taskDescription =
      typeof selectorOrTask === 'string'
        ? selectorOrTask
        : selectorOrTask.instruction || selectorOrTask.selector || 'Scrape page';

    this.addLog('info', `Scraping: ${taskDescription}`, { action: 'scrape', url: this.currentUrl });

    let scrapedData: any = null;

    if (this.innerBrowser) {
      try {
        if (typeof this.innerBrowser.extract === 'function') {
          scrapedData = await this.innerBrowser.extract(selectorOrTask);
        } else if (typeof this.innerBrowser.scrape === 'function') {
          scrapedData = await this.innerBrowser.scrape(selectorOrTask);
        } else if (this.innerBrowser.page && typeof this.innerBrowser.page.evaluate === 'function') {
          const selector = typeof selectorOrTask === 'string' ? selectorOrTask : selectorOrTask.selector;
          if (selector) {
            scrapedData = await this.innerBrowser.page.evaluate((sel: string) => {
              const els = Array.from(document.querySelectorAll(sel));
              return els.map(el => el.textContent?.trim());
            }, selector);
          } else {
            scrapedData = await this.innerBrowser.page.evaluate(() => document.body.innerText);
          }
        }
      } catch (err: any) {
        this.addLog('error', `Scraping failed: ${taskDescription} - ${err?.message || String(err)}`, {
          action: 'scrape',
          url: this.currentUrl,
          error: String(err),
        });
        throw err;
      }
    }

    this.addLog('info', `Scraping completed: ${taskDescription}`, {
      action: 'scrape',
      url: this.currentUrl,
      resultSummary: typeof scrapedData === 'object' ? JSON.stringify(scrapedData).slice(0, 200) : String(scrapedData),
    });

    return scrapedData;
  }

  /** Capture screenshot with options to save to file or return base64/binary */
  async captureScreenshot(options: ScreenshotOptions = {}): Promise<{ data: string; path?: string; format: string }> {
    const format = options.format ?? 'base64';
    let rawBase64 = DUMMY_PNG_BASE64;

    if (this.innerBrowser) {
      try {
        if (typeof this.innerBrowser.screenshot === 'function') {
          const res = await this.innerBrowser.screenshot({
            path: options.path,
            fullPage: options.fullPage,
            type: 'png',
          });
          if (Buffer.isBuffer(res)) {
            rawBase64 = res.toString('base64');
          } else if (typeof res === 'string') {
            rawBase64 = res.startsWith('data:') ? res.split(',')[1]! : res;
          }
        } else if (this.innerBrowser.page && typeof this.innerBrowser.page.screenshot === 'function') {
          const res = await this.innerBrowser.page.screenshot({
            path: options.path,
            fullPage: options.fullPage,
            type: 'png',
          });
          if (Buffer.isBuffer(res)) {
            rawBase64 = res.toString('base64');
          } else if (typeof res === 'string') {
            rawBase64 = res.startsWith('data:') ? res.split(',')[1]! : res;
          }
        }
      } catch (err: any) {
        this.addLog('warn', `Screenshot capture fallback: ${err?.message || String(err)}`, {
          action: 'screenshot',
        });
      }
    }

    if (options.path && rawBase64 === DUMMY_PNG_BASE64) {
      try {
        mkdirSync(dirname(options.path), { recursive: true });
        writeFileSync(options.path, Buffer.from(rawBase64, 'base64'));
      } catch {
        // ignore filesystem errors in fallback
      }
    }

    let returnData: string = rawBase64;
    if (format === 'data-url') {
      returnData = `data:image/png;base64,${rawBase64}`;
    }

    return {
      data: returnData,
      path: options.path,
      format,
    };
  }

  /** Start recording video of the web session */
  async startVideoRecording(outputDir?: string): Promise<void> {
    const targetDir = outputDir || join(getAppDataDir(), 'browser-recordings');
    mkdirSync(targetDir, { recursive: true });
    const videoPath = join(targetDir, `recording-${Date.now()}.webm`);

    this.recordingState = {
      recording: true,
      videoPath,
      startTime: Date.now(),
    };

    if (this.innerBrowser && typeof this.innerBrowser.startVideoRecording === 'function') {
      try {
        await this.innerBrowser.startVideoRecording({ path: videoPath });
      } catch (err: any) {
        this.addLog('warn', `Native video recording start fallback: ${err?.message || String(err)}`);
      }
    }

    this.addLog('info', `Video recording started at ${videoPath}`, { action: 'video_recording_start', videoPath });
  }

  /** Stop recording video of the web session */
  async stopVideoRecording(): Promise<VideoRecordingResult> {
    if (!this.recordingState.recording) {
      return { durationMs: 0, recording: false };
    }

    const durationMs = Date.now() - (this.recordingState.startTime ?? Date.now());
    const videoPath = this.recordingState.videoPath;

    if (this.innerBrowser && typeof this.innerBrowser.stopVideoRecording === 'function') {
      try {
        await this.innerBrowser.stopVideoRecording();
      } catch (err: any) {
        this.addLog('warn', `Native video recording stop fallback: ${err?.message || String(err)}`);
      }
    }

    this.recordingState = { recording: false };

    this.addLog('info', `Video recording stopped. Duration: ${durationMs}ms`, {
      action: 'video_recording_stop',
      videoPath,
      durationMs,
    });

    return {
      videoPath,
      durationMs,
      recording: false,
    };
  }

  /** Start visual preview stream (emitting frame events via SSE) */
  startVisualPreviewStream(intervalMs: number = 1000): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer);
    }
    this.streamTimer = setInterval(() => {
      void this.captureAndEmitFrame();
    }, intervalMs);

    this.addLog('info', `Visual preview stream started with interval ${intervalMs}ms`);
  }

  /** Stop visual preview stream */
  stopVisualPreviewStream(): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer);
      this.streamTimer = undefined;
      this.addLog('info', 'Visual preview stream stopped');
    }
  }

  /** Helper to capture current frame and emit SSE event */
  private async captureAndEmitFrame(): Promise<void> {
    try {
      const shot = await this.captureScreenshot({ format: 'data-url' });
      this.emitSSE({
        type: 'frame',
        timestamp: Date.now(),
        url: this.currentUrl,
        data: {
          image: shot.data,
          viewport: this.options.viewport,
        },
      });
    } catch (err: any) {
      this.addLog('debug', `Failed to capture frame for preview stream: ${err?.message || String(err)}`);
    }
  }

  /** Subscribe to SSE events for real-time visual preview stream in Factory UI */
  subscribeSSE(subscriber: (event: BrowserSSEEvent) => void): () => void {
    this.sseSubscribers.add(subscriber);
    // Send immediate initial status & frame
    subscriber({
      type: 'status',
      timestamp: Date.now(),
      data: { status: 'connected', url: this.currentUrl },
    });
    void this.captureAndEmitFrame();

    return () => {
      this.sseSubscribers.delete(subscriber);
    };
  }

  /** Create a standard HTTP SSE ReadableStream for Factory UI integration */
  createSSEResponseStream(): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;

    return new ReadableStream<Uint8Array>({
      start: controller => {
        unsubscribe = this.subscribeSSE((event: BrowserSSEEvent) => {
          const sseChunk = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(sseChunk));
        });
      },
      cancel: () => {
        if (unsubscribe) {
          unsubscribe();
        }
      },
    });
  }

  /** Emit an SSE event to all subscribers */
  private emitSSE(event: BrowserSSEEvent): void {
    for (const subscriber of this.sseSubscribers) {
      try {
        subscriber(event);
      } catch (err) {
        console.error('Error in SSE subscriber:', err);
      }
    }
  }

  /** Add a log entry for TUI exposure and SSE stream */
  addLog(level: ScrapingLogLevel, message: string, details?: Record<string, any>): ScrapingLogEntry {
    this.logIdCounter += 1;
    const entry: ScrapingLogEntry = {
      id: `log-${Date.now()}-${this.logIdCounter}`,
      timestamp: Date.now(),
      level,
      message,
      action: details?.action,
      url: details?.url || this.currentUrl,
      details,
    };

    this.logs.push(entry);

    for (const listener of this.logListeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error('Error in log listener:', err);
      }
    }

    this.emitSSE({
      type: 'log',
      timestamp: entry.timestamp,
      url: entry.url,
      data: entry,
    });

    return entry;
  }

  /** Retrieve accumulated logs for the TUI with optional filtering */
  getLogs(filter?: { level?: ScrapingLogLevel; action?: string }): ScrapingLogEntry[] {
    return this.logs.filter(log => {
      if (filter?.level && log.level !== filter.level) return false;
      if (filter?.action && log.action !== filter.action) return false;
      return true;
    });
  }

  /** Subscribe to log entries in real-time for TUI exposure */
  onLog(listener: (log: ScrapingLogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  /** Clear all logs */
  clearLogs(): void {
    this.logs = [];
  }

  /** Access the inner raw browser instance */
  getInnerBrowser(): any {
    return this.innerBrowser;
  }

  /** Close the browser session and clean up resources */
  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    this.stopVisualPreviewStream();

    if (this.recordingState.recording) {
      await this.stopVideoRecording();
    }

    if (this.innerBrowser && typeof this.innerBrowser.close === 'function') {
      try {
        await this.innerBrowser.close();
      } catch (err: any) {
        this.addLog('warn', `Error closing inner browser: ${err?.message || String(err)}`);
      }
    }

    this.addLog('info', 'Browser session closed', { action: 'close' });

    this.emitSSE({
      type: 'status',
      timestamp: Date.now(),
      data: { status: 'closed' },
    });

    this.sseSubscribers.clear();
    this.logListeners.clear();
  }
}
