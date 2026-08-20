import { config } from "dotenv";
import { resolve } from "path";
// Load .env.local before any other imports that reference process.env
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") }); // fallback

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { getPgListenServer } from "./pg-listen-server";
import { handleVideoStitchUpload } from "./upload-handler";

/**
 * Custom Next.js Server
 *
 * Required for pg-listen singleton to work in production.
 * Initializes pg-listen connection before starting Next.js app.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost"; // Next.js internal hostname
const port = parseInt(process.env.PORT || "3000", 10);
const bindHost = process.env.BIND_HOST || "0.0.0.0"; // Bind to all interfaces for external access

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function startServer() {
  try {
    console.warn("[server] Preparing Next.js app...");
    await app.prepare();

    console.warn("[server] Initializing pg-listen...");
    const pgListen = getPgListenServer();
    await pgListen.initialize();

    const server = createServer(async (req, res) => {
      try {
        // Handle large file uploads outside of Next.js to bypass 10MB limit
        // Next.js truncates request bodies > 10MB, but we need to support
        // large video uploads (up to 10GB) for video stitcher
        if (req.url === "/api/video-stitch/upload" && req.method === "POST") {
          await handleVideoStitchUpload(req, res);
          return;
        }

        const parsedUrl = parse(req.url!, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error("[server] Error handling request:", err);
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.warn(`[server] Received ${signal}, shutting down gracefully...`);

      // Close HTTP server
      server.close(() => {
        console.warn("[server] HTTP server closed");
      });

      // Shutdown pg-listen
      await pgListen.shutdown();

      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    server.listen(port, bindHost, () => {
      console.warn(`[server] Ready on http://${bindHost}:${port}`);
      console.warn(
        `[server] Environment: ${dev ? "development" : "production"}`,
      );
    });
  } catch (error) {
    console.error("[server] Failed to start:", error);
    process.exit(1);
  }
}

startServer();
