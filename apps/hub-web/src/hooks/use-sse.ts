"use client";

import { useEffect, useState, useRef, useCallback } from "react";

/**
 * useSSE Hook
 *
 * Client-side hook for subscribing to Server-Sent Events.
 * Automatically reconnects on connection loss.
 * Filters events by optional event type.
 */

export interface SSEEvent {
  id?: string;
  event_type?: string;
  job_id?: string | null;
  payload?: Record<string, any>;
  timestamp?: string;
  type?: string;
  clientId?: string;
}

export interface UseSSEResult {
  data: SSEEvent | null;
  isConnected: boolean;
  error: string | null;
  clientId: string | null;
}

export function useSSE(eventType?: string): UseSSEResult {
  const [data, setData] = useState<SSEEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const eventSource = new EventSource("/api/events");
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        // Connection established
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as SSEEvent;

          // Handle connection message
          if (parsed.type === "connection") {
            setClientId(parsed.clientId || null);
            return;
          }

          // Filter by event type if specified
          if (eventType && parsed.event_type !== eventType) {
            return;
          }

          setData(parsed);
        } catch (err) {
          console.error("[SSE] Failed to parse event:", err);
        }
      };

      eventSource.onerror = () => {
        console.error("[SSE] Connection error");
        setIsConnected(false);

        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts.current),
            30000,
          );
          reconnectAttempts.current++;

          // Log reconnection attempt
          setError(
            `Connection lost. Reconnecting... (${reconnectAttempts.current}/${maxReconnectAttempts})`,
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setError("Connection failed. Please refresh the page.");
          eventSource.close();
        }
      };
    } catch (err) {
      console.error("[SSE] Failed to create EventSource:", err);
      setError("Failed to establish connection");
    }
  }, [eventType]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return { data, isConnected, error, clientId };
}
