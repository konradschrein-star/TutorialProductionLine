import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
      copied: false
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleClearCacheAndReset = (): void => {
    if (confirm('Clear local workstation storage cache and reload? Your API keys and channel setups will be reset to defaults.')) {
      try {
        localStorage.clear();
      } catch {}
      window.location.reload();
    }
  };

  handleCopyError = (): void => {
    const errorText = `${this.state.error?.toString()}\n\nStack:\n${this.state.errorInfo?.componentStack || ''}`;
    navigator.clipboard.writeText(errorText);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="pro-panel max-w-lg w-full p-6 rounded-2xl space-y-4 text-center shadow-elevation">
            <div className="w-12 h-12 rounded-xl bg-surface-200 border border-border flex items-center justify-center text-red-500 mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h2 className="text-base font-bold font-display text-foreground">
                Workstation Unexpected State
              </h2>
              <p className="text-xs text-muted mt-1">
                An unhandled exception occurred in the UI runtime. Your session data has been preserved.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 rounded-lg bg-surface-200 border border-border text-[11px] font-mono text-left text-red-400 overflow-x-auto max-h-36">
                {this.state.error.toString()}
              </div>
            )}

            <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
              <button
                onClick={this.handleReset}
                className="btn-solid px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload Workstation
              </button>

              <button
                onClick={this.handleCopyError}
                className="btn-outline px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                {this.state.copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {this.state.copied ? 'Copied' : 'Copy Error Details'}
              </button>

              <button
                onClick={this.handleClearCacheAndReset}
                className="btn-outline px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 text-red-400 hover:text-red-300"
                title="Wipe local storage and restart fresh"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
