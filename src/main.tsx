import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { inject } from "@vercel/analytics";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import ErrorBoundary from "./ErrorBoundary";
import Methodology from "./Methodology";
import NewsletterPage from "./NewsletterPage";
import RoundupArchive, { type ArchiveInitial } from "./RoundupArchive";
import NotFound from "./NotFound";

const App = lazy(() => import("./App"));

inject();

const initialElement = document.getElementById("flockline-page-data");
const initial: ArchiveInitial & { status?: number } = initialElement ? JSON.parse(initialElement.textContent || "{}") : {};

// Match editorial pages before App mounts: its map-state URL sync would
// otherwise erase their paths and signup attribution. Keep old methodology
// bookmarks working alongside the new crawlable /methodology page.
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (initial.status === 404) return <NotFound />;
  if (path === "/methodology") return <Methodology />;
  if (path === "/newsletter") {
    return <NewsletterPage />;
  }
  if (path === "/roundup" || path.startsWith("/roundup/")) {
    return <RoundupArchive initial={initial} />;
  }
  if (path !== "/") return <NotFound />;

  return hash === "#methodology" ? <Methodology /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<p role="status">Loading the bird map…</p>}>
        <Root />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>
);
