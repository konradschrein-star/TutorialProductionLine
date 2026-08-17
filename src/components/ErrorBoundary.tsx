import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
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
                An unhandled exception occurred in the UI runtime. Your session data has been preserved in local storage.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 rounded-lg bg-surface-200 border border-border text-[11px] font-mono text-left text-red-400 overflow-x-auto max-h-36">
                {this.state.error.toString()}
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={this.handleReset}
                className="btn-solid px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 mx-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload Workstation
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
