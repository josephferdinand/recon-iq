import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportPlatformError } from "@/lib/error-reporting";
import { createErrorReference, USER_FACING_ERRORS } from "@/lib/user-facing-errors";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null; referenceId: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, referenceId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, referenceId: createErrorReference() };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    reportPlatformError(error, { boundary: this.props.label ?? "component", componentStack: info.componentStack, referenceId: this.state.referenceId });
  }

  reset = () => this.setState({ error: null, referenceId: null });

  render() {
    if (!this.state.error) return this.props.children;
    const copy = USER_FACING_ERRORS.unexpected;
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
          <div className="flex-1 min-w-0">
            <h3 className="font-medium">{copy.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{copy.message} {copy.action}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={this.reset}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">Error Reference ID: {this.state.referenceId}</p>
          </div>
        </div>
      </div>
    );
  }
}
