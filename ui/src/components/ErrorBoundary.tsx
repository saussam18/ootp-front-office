import { Component, type ReactNode } from "react";
import { Alert, Code } from "@mantine/core";

// Shows a page's render error instead of blanking the whole app.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert color="red" title="This page hit an error">
        <Code block>{this.state.error.stack ?? String(this.state.error)}</Code>
      </Alert>
    );
  }
}
