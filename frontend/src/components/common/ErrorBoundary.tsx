import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught application error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-card">
          <div className="rounded-full bg-[#FEF2F2] p-4 text-[#991B1B] mb-4 border border-[#FCA5A5]">
            <AlertCircle className="h-8 w-8 text-[#DC2626]" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-[#1E293B] mb-2">
            Unexpected Application Error
          </h2>
          <p className="text-sm text-[#475569] max-w-md mb-6 break-words">
            An unhandled runtime exception occurred during rendering.
            {this.state.error?.message ? ` (${this.state.error.message})` : ''}
          </p>
          <Button onClick={this.handleReset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload Page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
