/**
 * Browser Pool
 *
 * Manages Playwright browser instances with authentication and session persistence.
 * Handles:
 * - Cookie injection for Gemini/Perplexity authentication
 * - Concurrent request queueing
 * - Browser lifecycle management
 * - Session reuse to avoid repeated auth
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Cookie,
} from "playwright";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("browser-pool");

/**
 * Browser pool configuration
 */
interface BrowserPoolConfig {
  /** Maximum number of concurrent browser instances */
  maxInstances: number;
  /** Maximum age of a browser instance before recreation (ms) */
  maxInstanceAge: number;
  /** Timeout for browser operations (ms) */
  operationTimeout: number;
  /** Cookies for authentication (Gemini, Perplexity) */
  cookies: Cookie[];
}

/**
 * Browser instance metadata
 */
interface BrowserInstance {
  browser: Browser;
  context: BrowserContext;
  createdAt: Date;
  inUse: boolean;
}

/**
 * Browser operation request
 */
interface BrowserRequest<T> {
  operation: (page: Page) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<BrowserPoolConfig> = {
  maxInstances: 3,
  maxInstanceAge: 30 * 60 * 1000, // 30 minutes
  operationTimeout: 60 * 1000, // 60 seconds
  cookies: [],
};

/**
 * Browser Pool
 *
 * Manages a pool of authenticated Playwright browser instances.
 */
export class BrowserPool {
  private config: BrowserPoolConfig;
  private instances: BrowserInstance[] = [];
  private requestQueue: BrowserRequest<unknown>[] = [];
  private processingQueue = false;

  constructor(config: Partial<BrowserPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as BrowserPoolConfig;
    logger.info(
      {
        maxInstances: this.config.maxInstances,
        maxInstanceAge: this.config.maxInstanceAge,
        operationTimeout: this.config.operationTimeout,
        cookieCount: this.config.cookies.length,
      },
      "Browser pool initialized",
    );
  }

  /**
   * Execute an operation with a browser page
   * Queues the request if no instances are available
   */
  async execute<T>(operation: (page: Page) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request: BrowserRequest<T> = {
        operation,
        resolve,
        reject,
      };

      this.requestQueue.push(request as BrowserRequest<unknown>);
      this.processQueue();
    });
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;

    try {
      while (this.requestQueue.length > 0) {
        // Get available instance or create new one
        const instance = await this.getOrCreateInstance();

        // Get next request
        const request = this.requestQueue.shift();
        if (!request) break;

        // Execute request
        this.executeRequest(instance, request).catch((error) => {
          logger.error(
            { error: error.message },
            "Failed to execute browser request",
          );
        });
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Execute a request with a browser instance
   */
  private async executeRequest(
    instance: BrowserInstance,
    request: BrowserRequest<unknown>,
  ): Promise<void> {
    let page: Page | null = null;

    try {
      // Create new page
      page = await instance.context.newPage();

      // Set timeout
      page.setDefaultTimeout(this.config.operationTimeout);

      // Execute operation
      const result = await Promise.race([
        request.operation(page),
        this.createTimeout(this.config.operationTimeout),
      ]);

      request.resolve(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, "Browser operation failed");
      request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Close page
      if (page) {
        await page.close().catch((err) => {
          logger.warn({ error: err.message }, "Failed to close browser page");
        });
      }

      // Mark instance as available
      instance.inUse = false;

      // Process next request in queue
      this.processQueue();
    }
  }

  /**
   * Get an available instance or create a new one
   */
  private async getOrCreateInstance(): Promise<BrowserInstance> {
    // Clean up stale instances
    await this.cleanupStaleInstances();

    // Find available instance
    const available = this.instances.find((i) => !i.inUse);
    if (available) {
      available.inUse = true;
      return available;
    }

    // Create new instance if under limit
    if (this.instances.length < this.config.maxInstances) {
      const instance = await this.createInstance();
      instance.inUse = true;
      return instance;
    }

    // Wait for available instance
    return new Promise<BrowserInstance>((resolve) => {
      const checkInterval = setInterval(() => {
        const available = this.instances.find((i) => !i.inUse);
        if (available) {
          clearInterval(checkInterval);
          available.inUse = true;
          resolve(available);
        }
      }, 100);
    });
  }

  /**
   * Create a new browser instance with authentication
   */
  private async createInstance(): Promise<BrowserInstance> {
    logger.info("Creating new browser instance");

    // Launch browser
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
    });

    // Create context
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    // Inject cookies for authentication
    if (this.config.cookies.length > 0) {
      await context.addCookies(this.config.cookies);
      logger.info(
        { cookieCount: this.config.cookies.length },
        "Injected authentication cookies",
      );
    }

    const instance: BrowserInstance = {
      browser,
      context,
      createdAt: new Date(),
      inUse: false,
    };

    this.instances.push(instance);
    logger.info(
      { instanceCount: this.instances.length },
      "Browser instance created",
    );

    return instance;
  }

  /**
   * Clean up stale instances (older than maxInstanceAge)
   */
  private async cleanupStaleInstances(): Promise<void> {
    const now = Date.now();
    const staleInstances = this.instances.filter(
      (i) =>
        !i.inUse && now - i.createdAt.getTime() > this.config.maxInstanceAge,
    );

    for (const instance of staleInstances) {
      await this.destroyInstance(instance);
    }
  }

  /**
   * Destroy a browser instance
   */
  private async destroyInstance(instance: BrowserInstance): Promise<void> {
    try {
      await instance.browser.close();
      this.instances = this.instances.filter((i) => i !== instance);
      logger.info(
        { instanceCount: this.instances.length },
        "Browser instance destroyed",
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to destroy browser instance",
      );
    }
  }

  /**
   * Close all browser instances
   */
  async closeAll(): Promise<void> {
    logger.info(
      { instanceCount: this.instances.length },
      "Closing all browser instances",
    );

    await Promise.all(
      this.instances.map((instance) => this.destroyInstance(instance)),
    );

    this.instances = [];
    logger.info("All browser instances closed");
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timeout after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalInstances: number;
    activeInstances: number;
    queuedRequests: number;
  } {
    return {
      totalInstances: this.instances.length,
      activeInstances: this.instances.filter((i) => i.inUse).length,
      queuedRequests: this.requestQueue.length,
    };
  }
}
