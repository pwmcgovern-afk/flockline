import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes
} from "node:crypto";
import { Resend } from "resend";
import { DIGEST_REGIONS, normalizeDigestRegionIds } from "../shared/digestRegions.js";

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIRMATION_TOKEN_VERSION = 2;
const CONFIRMATION_IV_BYTES = 12;
const CONFIRMATION_TAG_BYTES = 16;

export function normalizeDigestEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (
    email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || email.includes("..")
  ) {
    return null;
  }
  return email;
}

export function getDigestConfiguration(environment = process.env) {
  const regions = DIGEST_REGIONS.map((region) => ({
    ...region,
    topicId: String(environment[region.topicEnvironment] || "").trim()
  }));
  const configuration = {
    apiKey: String(environment.RESEND_API_KEY || "").trim(),
    segmentId: String(environment.RESEND_DIGEST_SEGMENT_ID || "").trim(),
    signingSecret: String(environment.DIGEST_SIGNING_SECRET || "").trim(),
    from: String(environment.RESEND_FROM || "Flockline <digest@flockline.app>").trim(),
    replyTo: String(environment.RESEND_REPLY_TO || "").trim(),
    publicAppUrl: String(environment.PUBLIC_APP_URL || "https://flockline.app").trim().replace(/\/$/, ""),
    regions
  };

  const missing = [
    ...(!configuration.apiKey ? ["RESEND_API_KEY"] : []),
    ...(!configuration.segmentId ? ["RESEND_DIGEST_SEGMENT_ID"] : []),
    ...(!configuration.signingSecret ? ["DIGEST_SIGNING_SECRET"] : []),
    ...regions.filter((region) => !region.topicId).map((region) => region.topicEnvironment)
  ];

  return { ...configuration, ready: missing.length === 0, missing };
}

export function createDigestConfirmationToken({ email, regionIds }, secret, now = Date.now()) {
  const normalizedEmail = normalizeDigestEmail(email);
  const normalizedRegions = normalizeDigestRegionIds(regionIds);
  if (!normalizedEmail || !normalizedRegions.length || !secret) {
    throw new Error("A valid email, at least one region, and a signing secret are required.");
  }

  const body = Buffer.from(JSON.stringify({
    version: 1,
    email: normalizedEmail,
    regionIds: normalizedRegions,
    expiresAt: now + CONFIRMATION_TTL_MS
  }));
  const iv = randomBytes(CONFIRMATION_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", confirmationKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([CONFIRMATION_TOKEN_VERSION]),
    iv,
    tag,
    encrypted
  ]).toString("base64url");
}

export function verifyDigestConfirmationToken(token, secret, now = Date.now()) {
  if (!token || !secret) {
    return null;
  }

  try {
    const packed = Buffer.from(String(token), "base64url");
    const minimumLength = 1 + CONFIRMATION_IV_BYTES + CONFIRMATION_TAG_BYTES + 1;
    if (packed.length < minimumLength || packed[0] !== CONFIRMATION_TOKEN_VERSION) {
      return null;
    }
    const ivStart = 1;
    const tagStart = ivStart + CONFIRMATION_IV_BYTES;
    const bodyStart = tagStart + CONFIRMATION_TAG_BYTES;
    const iv = packed.subarray(ivStart, tagStart);
    const tag = packed.subarray(tagStart, bodyStart);
    const encrypted = packed.subarray(bodyStart);
    const decipher = createDecipheriv("aes-256-gcm", confirmationKey(secret), iv);
    decipher.setAuthTag(tag);
    const body = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const payload = JSON.parse(body.toString("utf8"));
    const email = normalizeDigestEmail(payload.email);
    const regionIds = normalizeDigestRegionIds(payload.regionIds);
    if (
      payload.version !== 1
      || !email
      || !regionIds.length
      || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt < now
    ) {
      return null;
    }
    return { email, regionIds, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

export function buildDigestConfirmationEmail({ email, regionIds, token, configuration }) {
  const selectedNames = configuration.regions
    .filter((region) => regionIds.includes(region.id))
    .map((region) => region.name);
  const confirmUrl = `${configuration.publicAppUrl}/api/digest-confirm?token=${encodeURIComponent(token)}`;
  const escapedUrl = escapeHtml(confirmUrl);
  const regionCopy = formatList(selectedNames);

  return {
    from: configuration.from,
    ...(configuration.replyTo ? { replyTo: configuration.replyTo } : {}),
    to: email,
    subject: "Confirm your Flockline weekly digest",
    text: [
      "Confirm your Flockline weekly digest",
      "",
      `You asked to receive: ${regionCopy}.`,
      "",
      `Confirm your subscription: ${confirmUrl}`,
      "",
      "This link expires in 24 hours. If you did not request this, you can ignore this email."
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f0eee8;color:#252722;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">One click confirms your selected regional birding editions.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0eee8;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fbfaf6;border:1px solid #d9d5ca;border-radius:18px;">
          <tr><td style="padding:34px 34px 12px;font-family:Georgia,serif;font-size:15px;letter-spacing:.16em;text-transform:uppercase;">Flockline</td></tr>
          <tr><td style="padding:8px 34px 0;font-family:Georgia,serif;font-size:30px;line-height:1.2;">Confirm your weekly digest</td></tr>
          <tr><td style="padding:18px 34px 0;font-size:16px;line-height:1.6;color:#4f514b;">You asked to receive <strong>${escapeHtml(regionCopy)}</strong>. Each selected edition arrives separately on Monday morning.</td></tr>
          <tr><td style="padding:26px 34px;">
            <a href="${escapedUrl}" style="display:inline-block;background:#384c3e;color:#fff;text-decoration:none;border-radius:999px;padding:13px 20px;font-size:15px;font-weight:700;">Confirm subscription</a>
          </td></tr>
          <tr><td style="padding:0 34px 34px;font-size:13px;line-height:1.55;color:#76786f;">This link expires in 24 hours. If you did not request this, you can ignore this email.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  };
}

export async function sendDigestConfirmation({ email, regionIds }, configuration, resend = new Resend(configuration.apiKey)) {
  const token = createDigestConfirmationToken(
    { email, regionIds },
    configuration.signingSecret
  );
  const message = buildDigestConfirmationEmail({ email, regionIds, token, configuration });
  const idempotencyKey = `digest-confirm-${createHmac("sha256", configuration.signingSecret)
    .update(`${email}|${regionIds.join(",")}|${new Date().toISOString().slice(0, 10)}`)
    .digest("hex")}`;
  const { data, error } = await resend.emails.send(message, { idempotencyKey });
  if (error) {
    throw new Error(error.message || "Resend could not send the confirmation email.");
  }
  return data;
}

export async function confirmDigestContact({ email, regionIds }, configuration, resend = new Resend(configuration.apiKey)) {
  const topics = configuration.regions.map((region) => ({
    id: region.topicId,
    subscription: regionIds.includes(region.id) ? "opt_in" : "opt_out"
  }));

  const existing = await resend.contacts.get({ email });
  if (existing.error && !isNotFound(existing.error)) {
    throw new Error(existing.error.message || "Resend could not read the subscriber.");
  }

  if (existing.error) {
    const created = await resend.contacts.create({
      email,
      unsubscribed: false,
      segments: [{ id: configuration.segmentId }],
      topics
    });
    if (created.error) {
      throw new Error(created.error.message || "Resend could not create the subscriber.");
    }
    return created.data;
  }

  const updated = await resend.contacts.update({ email, unsubscribed: false });
  if (updated.error) {
    throw new Error(updated.error.message || "Resend could not reactivate the subscriber.");
  }

  const memberships = await resend.contacts.segments.list({ email });
  if (memberships.error) {
    throw new Error(memberships.error.message || "Resend could not read segment membership.");
  }
  if (!memberships.data?.data?.some((segment) => segment.id === configuration.segmentId)) {
    const added = await resend.contacts.segments.add({
      email,
      segmentId: configuration.segmentId
    });
    if (added.error) {
      throw new Error(added.error.message || "Resend could not add the subscriber to the digest.");
    }
  }

  const topicUpdate = await resend.contacts.topics.update({ email, topics });
  if (topicUpdate.error) {
    throw new Error(topicUpdate.error.message || "Resend could not save regional preferences.");
  }
  return updated.data;
}

function confirmationKey(secret) {
  return createHash("sha256").update(String(secret)).digest();
}

function isNotFound(error) {
  return Number(error?.statusCode) === 404
    || Number(error?.status) === 404
    || String(error?.name || "").toLowerCase() === "not_found";
}

function formatList(items) {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
