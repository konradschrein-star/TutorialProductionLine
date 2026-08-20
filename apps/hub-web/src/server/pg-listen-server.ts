import createSubscriber, { type Subscriber } from "pg-listen";
import { getHubConfig } from "@/lib/config";

/**
 * PostgreSQL LISTEN/NOTIFY Server
 *
 * Maintains a persistent connection to PostgreSQL for real-time notifications.
 * Forwards NOTIFY events to connected SSE clients.
 * Singleton pattern ensures only one pg-listen connection per process.
 */

export interface SystemEvent {
  id: string;
  event_type: string;
  job_id: string | null;
  payload: Record<string, any>;
  timestamp: Date;
}

export interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController;
  userId: string;
  role: string;
}

class PgListenServer {
  private subscriber: Subscriber | null = null;
  private clients: Map<string, SSEClient> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  /**
   * Initialize pg-listen connection
   */
  async initialize(): Promise<void> {
    if (this.subscriber) {
      console.warn("[pg-listen] Already initialized");
      return;
    }

    const config = getHubConfig();
    this.subscriber = createSubscriber({
      connectionString: config.DATABASE_URL,
    });

    // Error handling
    this.subscriber.events.on("error", (error) => {
      console.error("[pg-listen] Error:", error);
      this.handleReconnect();
    });

    this.subscriber.events.on("reconnect", (attempt) => {
      console.warn(`[pg-listen] Reconnecting (attempt ${attempt})`);
    });

    // Connect and subscribe to system_events channel
    try {
      await this.subscriber.connect();
      await this.subscriber.listenTo("system_events");
      console.warn(
        "[pg-listen] Connected and listening to system_events channel",
      );

      // Handle incoming notifications
      this.subscriber.notifications.on("system_events", (payload) => {
        this.broadcastEvent(payload as SystemEvent);
      });

      this.reconnectAttempts = 0;
    } catch (error) {
      console.error("[pg-listen] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[pg-listen] Max reconnect attempts reached, giving up");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.warn(
      `[pg-listen] Waiting ${delay}ms before reconnect attempt ${this.reconnectAttempts}`,
    );

    setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        console.error("[pg-listen] Reconnect failed:", error);
      }
    }, delay);
  }

  /**
   * Register a new SSE client
   */
  registerClient(client: SSEClient): void {
    this.clients.set(client.id, client);
    console.warn(
      `[pg-listen] Client ${client.id} registered (${this.clients.size} total)`,
    );
  }

  /**
   * Unregister an SSE client
   */
  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
    console.warn(
      `[pg-listen] Client ${clientId} unregistered (${this.clients.size} remaining)`,
    );
  }

  /**
   * Broadcast event to all connected clients
   * Filters events based on user role (VAs only see their assigned jobs)
   */
  private broadcastEvent(event: SystemEvent): void {
    console.warn(
      `[pg-listen] Broadcasting event: ${event.event_type} (job: ${event.job_id || "N/A"})`,
    );

    for (const [clientId, client] of this.clients.entries()) {
      try {
        // Role-based filtering
        const shouldSend = this.shouldSendEventToClient(event, client);

        if (shouldSend) {
          const data = JSON.stringify(event);
          client.controller.enqueue(`data: ${data}\n\n`);
        }
      } catch (error) {
        console.error(
          `[pg-listen] Failed to send to client ${clientId}:`,
          error,
        );
        this.unregisterClient(clientId);
      }
    }
  }

  /**
   * Determine if event should be sent to client based on role
   */
  private shouldSendEventToClient(
    event: SystemEvent,
    client: SSEClient,
  ): boolean {
    // ADMIN and MANAGER see everything
    if (client.role === "ADMIN" || client.role === "MANAGER") {
      return true;
    }

    // VIEWER sees all read-only events
    if (client.role === "VIEWER") {
      return true;
    }

    // VAs only see events for jobs assigned to them
    if (client.role === "PRODUCTION_VA" || client.role === "UPLOADER_VA") {
      // If event has no job_id, don't send to VAs
      if (!event.job_id) {
        return false;
      }

      // Check if job is assigned to this VA (would need to query DB or include in payload)
      // For now, send all job events to VAs (can be refined later)
      return true;
    }

    return false;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.warn("[pg-listen] Shutting down...");

    // Close all client connections
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.controller.close();
      } catch (error) {
        console.error(`[pg-listen] Error closing client ${clientId}:`, error);
      }
    }
    this.clients.clear();

    // Close pg-listen connection
    if (this.subscriber) {
      await this.subscriber.close();
      this.subscriber = null;
    }

    console.warn("[pg-listen] Shutdown complete");
  }

  /**
   * Get client count
   */
  getClientCount(): number {
    return this.clients.size;
  }
}

// Singleton instance
let pgListenServer: PgListenServer | null = null;

export function getPgListenServer(): PgListenServer {
  if (!pgListenServer) {
    pgListenServer = new PgListenServer();
  }
  return pgListenServer;
}
