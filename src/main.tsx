import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import Methodology from "./Methodology";

// Tiny hash router: /#methodology serves the methodology page, everything else
// is the map. Hash routing needs no server rewrite and survives refresh and
// direct links, since the hash never reaches the server.
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

  return hash === "#methodology" ? <Methodology /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>
);
