import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a render crash on one screen from blanking the whole Mini App.
 * Shows a small recoverable message instead of freezing the UI.
 */
export default class ScreenErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('[screen-error]', error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex flex-col items-center justify-center h-full w-full px-8 gap-3 text-center">
        <div className="text-4xl">⚠️</div>
        <p className="text-foreground font-bold text-sm">Something went wrong</p>
        <button
          onClick={() => this.setState({ error: null })}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs"
        >
          Try again
        </button>
      </div>
    );
  }
}
