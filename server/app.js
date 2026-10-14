import cors from "cors";
import express from "express";
import configHandler from "../api/config.js";
import speciesHandler from "../api/species.js";
import sightingsHandler from "../api/sightings.js";
import insightsHandler from "../api/insights.js";
import roundupHandler from "../api/roundup.js";
import checklistHandler from "../api/checklist.js";
import sightingHandler from "../api/sighting.js";
import chatHandler from "../api/chat.js";
import roundupArchiveHandler from "../api/roundup-archive.js";
import digestSubscriptionHandler from "../api/digest-subscription.js";
import digestConfirmHandler from "../api/digest-confirm.js";
import illustrationPrewarmHandler from "../api/cron/illustration-prewarm.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "64kb" }));

  // Run the production handlers locally, including their method checks,
  // cache policy, rate limits, error status codes, and disconnect cleanup.
  const dataRoutes = {
    "/api/config": configHandler,
    "/api/species": speciesHandler,
    "/api/sightings": sightingsHandler,
    "/api/insights": insightsHandler,
    "/api/roundup": roundupHandler,
    "/api/checklist": checklistHandler,
    "/api/sighting": sightingHandler,
    "/api/chat": chatHandler,
    "/api/roundup-archive": roundupArchiveHandler,
  };
  for (const [path, handler] of Object.entries(dataRoutes)) app.all(path, handler);

  // Preserve the existing explicit subscription and authenticated preparation
  // routes. The email-sending cron is intentionally not mounted in development.
  app.post("/api/digest-subscription", digestSubscriptionHandler);
  app.get("/api/digest-confirm", digestConfirmHandler);
  app.get("/api/cron/illustration-prewarm", illustrationPrewarmHandler);
  return app;
}
