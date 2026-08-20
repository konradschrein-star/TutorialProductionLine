import { NextRequest, NextResponse } from "next/server";
import { createRequestLogger, generateRequestId } from "@repo/logger";

/**
 * Request logging middleware
 *
 * Logs all HTTP requests with:
 * - Request ID for tracing
 * - Method and path
 * - Response status
 * - Duration in milliseconds
 * - User agent (optional)
 *
 * Usage: Import in middleware.ts and apply to all routes
 */
export function withRequestLogging(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const method = request.method;
  const path = request.nextUrl.pathname;
  const startTime = Date.now();

  const reqLogger = createRequestLogger(requestId, method, path);

  // Log incoming request
  reqLogger.info(
    {
      userAgent: request.headers.get("user-agent") || undefined,
      ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
    },
    `→ ${method} ${path}`
  );

  return handler()
    .then((response) => {
      const durationMs = Date.now() - startTime;

      // Log successful response
      reqLogger.info(
        {
          status: response.status,
          durationMs,
        },
        `← ${method} ${path} ${response.status} (${durationMs}ms)`
      );

      // Add request ID to response headers for debugging
      response.headers.set("x-request-id", requestId);

      return response;
    })
    .catch((error: Error) => {
      const durationMs = Date.now() - startTime;

      // Log error response
      reqLogger.error(
        {
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
          durationMs,
        },
        `✗ ${method} ${path} error (${durationMs}ms)`
      );

      throw error;
    });
}

/**
 * Create a simple middleware wrapper for API routes
 *
 * Example usage in API route:
 * ```ts
 * export async function GET(request: NextRequest) {
 *   return withApiLogging(request, async () => {
 *     // Your API logic here
 *     return NextResponse.json({ data: "..." });
 *   });
 * }
 * ```
 */
export function withApiLogging(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  return withRequestLogging(request, handler);
}
