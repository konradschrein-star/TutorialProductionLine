'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FormatMindMap } from './format-mind-map';
import { TemplateCreationForm } from './template-creation-form';

interface Template {
  id: string;
  name: string;
  format: string;
  description: string | null;
  is_active: boolean;
}

interface Channel {
  id: string;
  name: string;
  youtube_channel_id: string;
  language: string;
}

interface JobCreationOrchestratorProps {
  templates: Template[];
  channels: Channel[];
}

export function JobCreationOrchestrator({
  templates,
  channels,
}: JobCreationOrchestratorProps) {
  const router = useRouter();
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const handleTemplateSelect = useCallback((template: Template) => {
    setSelectedTemplate(template);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTemplate(null);
  }, []);

  const handleDispatchComplete = useCallback(() => {
    // Auto-redirect to jobs tab after successful dispatch
    router.push('/jobs');
  }, [router]);

  if (selectedTemplate) {
    return (
      <TemplateCreationForm
        template={selectedTemplate}
        channels={channels}
        onBack={handleBack}
        onDispatchComplete={handleDispatchComplete}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#e5e2e1',
            margin: '0 0 8px 0',
            letterSpacing: '-0.02em',
          }}
        >
          Create Content Jobs
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(205,195,215,0.6)', margin: 0 }}>
          Select a template to start batch job creation
        </p>
      </div>

      {/* Mind map */}
      <FormatMindMap
        templates={templates}
        onTemplateSelect={handleTemplateSelect}
      />
    </div>
  );
}
