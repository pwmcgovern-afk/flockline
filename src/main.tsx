import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { inject } from "@vercel/analytics";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import Methodology from "./Methodology";
import NewsletterPage from "./NewsletterPage";
import RoundupArchive from "./RoundupArchive";

inject();

// Tiny router. Two standalone marketing surfaces get real paths (/newsletter,
// /roundup/...) because promotion links need clean, shareable URLs; the SPA
// rewrite in vercel.json already serves the shell for any path. These pages
// must be matched HERE, before <App/> mounts: App's URL-sync effect rewrites
// the address bar to "/" on its first render and would erase both the path
// and any ?src= attribution. Everything else keeps the original hash routing
// (/#methodology), which needs no server rewrite.
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
  if (path === "/newsletter") {
    return <NewsletterPage />;
  }
  if (path === "/roundup" || path.startsWith("/roundup/")) {
    return <RoundupArchive />;
  }

  return hash === "#methodology" ? <Methodology /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>
);
