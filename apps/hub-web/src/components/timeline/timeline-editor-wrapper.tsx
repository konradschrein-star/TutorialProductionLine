'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimelineEditor } from './timeline-editor';

// Scoped QueryClient for the timeline editor
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
});

interface TimelineEditorWrapperProps {
  jobId: string;
  jobTitle: string;
}

/**
 * TimelineEditorWrapper
 *
 * Client boundary component that provides the QueryClient context
 * for the timeline editor. Keeps the timeline's QueryClient isolated
 * from the main app's QueryClient.
 */
export function TimelineEditorWrapper({ jobId, jobTitle }: TimelineEditorWrapperProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <TimelineEditor jobId={jobId} jobTitle={jobTitle} />
    </QueryClientProvider>
  );
}
