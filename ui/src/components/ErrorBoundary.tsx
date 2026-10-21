import { Component, type ReactNode } from "react";
import { Alert } from "./ui";

// Shows a page's render error instead of blanking the whole app.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert tone="bad" title="This page hit an error">
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{this.state.error.stack ?? String(this.state.error)}</pre>
      </Alert>
    );
  }
}
