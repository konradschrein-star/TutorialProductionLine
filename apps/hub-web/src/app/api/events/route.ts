import { NextRequest } from 'next/server';
import { getPgListenServer, type SSEClient } from '@/server/pg-listen-server';
import { getSession } from '@/lib/auth/session';

/**
 * SSE Route Handler
 *
 * GET /api/events - Server-Sent Events endpoint for real-time updates.
 * Authenticates user, registers with pg-listen server, streams events.
 * Sends keep-alive pings every 30 seconds to prevent connection timeout.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Authenticate user
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const pgListen = getPgListenServer();

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      // Generate client ID
      const clientId = `${session.userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const client: SSEClient = {
        id: clientId,
        controller,
        userId: session.userId,
        role: session.role,
      };

      // Register client with pg-listen server
      pgListen.registerClient(client);

      // Send initial connection message
      const connectionMsg = JSON.stringify({
        type: 'connection',
        clientId,
        timestamp: new Date().toISOString(),
      });
      controller.enqueue(`data: ${connectionMsg}\n\n`);

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(`: keep-alive ${Date.now()}\n\n`);
        } catch (error) {
          console.error('[SSE] Keep-alive failed:', error);
          clearInterval(keepAliveInterval);
          pgListen.unregisterClient(clientId);
        }
      }, 30000);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAliveInterval);
        pgListen.unregisterClient(clientId);
        try {
          controller.close();
        } catch (error) {
          // Controller already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
