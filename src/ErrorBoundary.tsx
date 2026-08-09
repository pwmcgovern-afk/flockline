import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * Wraps the whole app, and it has to: React evaluates JSX children during the
 * PARENT's render, so a throw inside App's own markup happens before any
 * boundary placed inside App is ever reached. Only a boundary above App can
 * catch it. Nothing was wrapped at all before, so one bad render blanked the
 * page, map included, with no way back except a reload the reader had to think
 * of themselves.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Without this a crash is silent for everyone but the person looking at it.
    console.error("[flockline] render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div className="app-error" role="alert">
        <span className="app-error-mark">flockline</span>
        <h1>Something went wrong.</h1>
        <p>
          The map hit an error it could not recover from. Reloading usually clears it. If it keeps
          happening, the eBird feed may be returning something unexpected.
        </p>
        <div className="app-error-actions">
          <button type="button" className="pill" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="pill"
            // A bad species or region in the URL is a common way to get here,
            // so offer the clean slate as well as the retry.
            onClick={() => {
              window.location.href = window.location.origin + "/";
            }}
          >
            Start over
          </button>
        </div>
      </div>
    );
  }
}
