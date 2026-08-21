import {
  confirmDigestContact,
  getDigestConfiguration,
  verifyDigestConfirmationToken
} from "../lib/digestSubscriptions.js";
import { recordSignupEvent } from "../lib/signupEvents.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).send("Method not allowed.");
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  const configuration = getDigestConfiguration();
  if (!configuration.ready) {
    response.status(503).send(renderStatusPage(
      "Subscription unavailable",
      "Flockline could not finish connecting the weekly digest. Please try the confirmation link again later.",
      configuration.publicAppUrl
    ));
    return;
  }

  const subscription = verifyDigestConfirmationToken(
    request.query?.token,
    configuration.signingSecret
  );
  if (!subscription) {
    response.status(400).send(renderStatusPage(
      "That link has expired",
      "Return to Flockline and request a new weekly digest confirmation.",
      configuration.publicAppUrl
    ));
    return;
  }

  try {
    await confirmDigestContact(subscription, configuration);
    try {
      await recordSignupEvent({
        type: "confirmed",
        src: subscription.src,
        regionIds: subscription.regionIds,
        email: subscription.email
      });
    } catch (eventError) {
      // Attribution is best-effort; the subscription itself already succeeded.
      console.error(JSON.stringify({
        event: "digest_signup_event_failed",
        message: eventError?.message
      }));
    }
    const destination = new URL(configuration.publicAppUrl);
    destination.searchParams.set("digest", "confirmed");
    destination.searchParams.set("digestRegions", subscription.regionIds.join(","));
    response.redirect(303, destination.toString());
  } catch (error) {
    console.error(JSON.stringify({
      event: "digest_confirmation_save_failed",
      message: error?.message
    }));
    response.status(502).send(renderStatusPage(
      "Confirmation did not finish",
      "Your link is still valid for 24 hours. Please try it again in a moment.",
      configuration.publicAppUrl
    ));
  }
}

function renderStatusPage(title, message, appUrl) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)} · Flockline</title>
  </head>
  <body style="margin:0;background:#f0eee8;color:#252722;font-family:Arial,sans-serif;">
    <main style="max-width:560px;margin:12vh auto;padding:28px;">
      <p style="font-family:Georgia,serif;letter-spacing:.16em;text-transform:uppercase;">Flockline</p>
      <h1 style="font-family:Georgia,serif;font-size:38px;font-weight:400;line-height:1.15;">${escapeHtml(title)}</h1>
      <p style="color:#565950;font-size:17px;line-height:1.65;">${escapeHtml(message)}</p>
      <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:16px;background:#384c3e;color:#fff;text-decoration:none;border-radius:999px;padding:13px 20px;font-weight:700;">Return to Flockline</a>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
