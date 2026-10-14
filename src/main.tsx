import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { inject } from "@vercel/analytics";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./discovery.css";
import ErrorBoundary from "./ErrorBoundary";
import Methodology from "./Methodology";
import NewsletterPage from "./NewsletterPage";
import RoundupArchive, { type ArchiveInitial } from "./RoundupArchive";
import NotFound from "./NotFound";
import SightingPage, { type SightingDetails } from "./SightingPage";

const App = lazy(() => import("./App"));

inject();

const initialElement = document.getElementById("flockline-page-data");
const initial: ArchiveInitial & { status?: number; sighting?: SightingDetails } = initialElement ? JSON.parse(initialElement.textContent || "{}") : {};

// Match editorial pages before App mounts: its map-state URL sync would
// otherwise erase their paths and signup attribution. Keep old methodology
// bookmarks working alongside the new crawlable /methodology page.
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // The client render replaces the server markup, so native fragment scrolling
    // can happen before the final target exists. Restore it after React commits.
    if (path === "/" && (!hash || hash === "#methodology")) {
      window.scrollTo(0, 0);
      return;
    }
    if (!hash) return;
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // A malformed bookmark fragment must not make the page unusable.
    }
  }, [hash, path]);

  if (initial.status === 404) return <NotFound />;
  if (path === "/methodology") return <Methodology />;
  if (path === "/newsletter") {
    return <NewsletterPage />;
  }
  if (path === "/roundup" || path.startsWith("/roundup/")) {
    return <RoundupArchive initial={initial} />;
  }
  if (path.startsWith("/sightings/")) return <SightingPage initial={initial.sighting} />;
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
