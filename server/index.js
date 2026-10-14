import "dotenv/config";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(PORT, "127.0.0.1", () => {
  console.log(`eBird proxy running on http://127.0.0.1:${PORT}`);
  console.log(process.env.EBIRD_API_KEY ? "Live eBird API mode enabled." : "EBIRD_API_KEY missing; using demo sightings.");
});
