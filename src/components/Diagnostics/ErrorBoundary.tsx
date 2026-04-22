import React from 'react';
import { recordBreadcrumb, stringifyUnknownError } from '../../lib/diagnostics';

type ErrorBoundaryProps = {
  name: string;
  children: React.ReactNode;
  fallback?: (info: { name: string; error: Error; reset: () => void }) => React.ReactNode;
  onError?: (info: { name: string; error: Error; componentStack?: string }) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const { message, stack } = stringifyUnknownError(error);
    const componentStack = (info as any)?.componentStack ?? undefined;
    recordBreadcrumb('react-error', { name: this.props.name, message, stack, componentStack });
    this.props.onError?.({ name: this.props.name, error, componentStack });
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback({ name: this.props.name, error: this.state.error, reset: this.reset });
      return null;
    }
    return this.props.children;
  }
}
