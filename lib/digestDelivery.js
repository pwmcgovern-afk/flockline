import { getWeeklyRoundup } from "./ebirdCore.js";
import { addBirdIllustrations, missingBirdIllustrations } from "./birdIllustrations.js";
import { loadDigestRoundup } from "./digestPreparation.js";
import { buildWeeklyDigestBroadcast } from "./digestEmail.js";
import { saveRoundup } from "./roundupArchive.js";
import { createDigestStore, deliveryPath, digestFailureEvidence, withDigestLease } from "./digestDeliveryStore.js";
import { createDigestProvider } from "./digestProvider.js";
import { factualEditorialPayload } from "../shared/findingCopy.js";

export async function runDigestEdition({ configuration, region, date, checkOnly = false, allowPartialArtwork = false }, {
  store = createDigestStore(), provider = createDigestProvider(configuration.apiKey),
  getRoundup = getWeeklyRoundup, illustrate = addBirdIllustrations, archive = saveRoundup,
  now = Date.now
} = {}) {
  const prepare = async (saved) => {
    const roundup = await loadDigestRoundup({ region, date, saved, getRoundup });
    // Art generation belongs to prewarm jobs. Email delivery uses the cache
    // and must never spend its function lifetime waiting for an image model.
    return illustrate(roundup, configuration.publicAppUrl, { generateMissing: false });
  };
  const archiveUrl = `${configuration.publicAppUrl}/roundup/${region.id}/${date}?src=email`;

  if (checkOnly) {
    const path = deliveryPath(date, region.id, "check");
    const previous = await store.read(path);
    let phase = "verify_sender";
    try {
      await provider.verifySender(configuration.from);
      phase = "check_recipients";
      const hasRecipients = await provider.hasRecipients(configuration, region);
      phase = "prepare_roundup";
      const edition = await store.read(deliveryPath(date, region.id));
      const roundup = await prepare(edition?.value.roundup);
      const unresolved = missingBirdIllustrations(roundup);
      const broadcast = buildWeeklyDigestBroadcast(roundup, configuration, { archiveUrl });
      const result = {
        date, region: region.id, status: unresolved.length ? "awaiting_illustrations" : "ready", checkedAt: new Date(now()).toISOString(),
        hasRecipients, findings: roundup.findings.length,
        illustrations: roundup.findings.length - unresolved.length, unresolved,
        htmlBytes: Buffer.byteLength(broadcast.html), sent: false, operation: "check", phase: "complete"
      };
      await store.write(path, result, previous?.etag);
      return result;
    } catch (error) {
      await store.write(path, { date, region: region.id, status: "failed", checkedAt: new Date(now()).toISOString(), sent: false,
        operation: "check", phase, failure: digestFailureEvidence(error, { operation: "check", phase, now })
      }, previous?.etag).catch(() => {});
      throw error;
    }
  }

  return withDigestLease({ date, region: region.id, store, now }, async (state, save) => {
    // Retries re-check the audience so a new subscriber still gets this week's
    // issue. If that re-check fails on an edition already finished with no
    // audience, keep the finished result: on November 16 a network blip at the
    // last retry turned Nationwide's correct "no_recipients" into "failed".
    const finishedEmpty = state.status === "no_recipients" && state.archived === true;
    const checkRecipients = async () => {
      await save({ phase: "check_recipients" });
      let hasRecipients;
      try {
        hasRecipients = await provider.hasRecipients(configuration, region);
      } catch (error) {
        if (!finishedEmpty) throw error;
        await save({ status: "no_recipients", hasRecipients: false, phase: "complete",
          failure: digestFailureEvidence(error, { operation: "delivery", phase: "check_recipients", now }) });
        return null;
      }
      if (!hasRecipients) await save({ status: "no_recipients", hasRecipients: false, phase: "complete" });
      return hasRecipients;
    };
    let roundup = state.roundup;
    if (!roundup) {
      roundup = await loadDigestRoundup({ region, date, getRoundup });
      await save({ roundup, status: "prepared" });
    }
    // Retry the cache for the pinned birds after prewarm fills any gaps.
    // Once a provider draft exists, preserve it for duplicate-safe recovery.
    if (!state.broadcastId) {
      await save({ phase: "illustrations" });
      roundup = await prepare(roundup);
      const unresolved = missingBirdIllustrations(roundup);
      await save({ roundup, findings: roundup.findings.length,
        illustrations: roundup.findings.length - unresolved.length, unresolved });
      if (unresolved.length && !allowPartialArtwork) {
        await save({ status: "awaiting_illustrations", phase: "awaiting_illustrations" });
        return;
      }
      // Last scheduled attempt of the week: a digest with a few text-only
      // birds beats no digest. Missing art once silently held three editions.
      if (unresolved.length) await save({ partialArtwork: true });
    }
    // Retrying the same saved content preserves the actual issue and its URL.
    await save({ phase: "archive" });
    await archive(roundup);
    await save({ archived: true, phase: "reconcile_broadcast" });

    const correctedRoundup = factualEditorialPayload(roundup);
    const broadcast = buildWeeklyDigestBroadcast(correctedRoundup, configuration, { archiveUrl });
    const editorialPolicy = correctedRoundup.editorialPolicy;
    let draftEditorialPolicy = state.broadcastId ? state.broadcastEditorialPolicy : null;
    let existing = state.broadcastId
      ? await provider.getBroadcast(state.broadcastId)
      : await provider.findBroadcast(broadcast.name);
    if (!existing) {
      const recipients = await checkRecipients();
      if (recipients !== true) return;
      await save({ phase: "create_draft" });
      existing = await provider.createDraft(broadcast);
      if (!existing?.id) throw new Error("Resend did not return a broadcast ID.");
      // Persist the ID BEFORE sending. Retrying this ID cannot create a second
      // campaign, including when Resend accepted a send but its response was lost.
      await save({ broadcastId: existing.id, broadcastEditorialPolicy: editorialPolicy, status: "draft", hasRecipients: true, phase: "reconcile_broadcast" });
      draftEditorialPolicy = editorialPolicy;
      existing = await provider.getBroadcast(existing.id);
    } else {
      await save({ broadcastId: existing.id });
    }

    if (existing.status === "draft") {
      const recipients = await checkRecipients();
      if (recipients !== true) return;
      if (draftEditorialPolicy !== editorialPolicy) {
        // A draft created before a deployment may still contain old prose.
        // Correct that same campaign, then durably record the successful
        // update before sending. An uncertain update/write stops this attempt;
        // a retry safely repeats the update without creating another campaign.
        await save({ phase: "update_draft" });
        const updated = await provider.updateDraft(existing.id, broadcast);
        if (updated?.id !== existing.id) throw new Error("Resend did not confirm the corrected draft.");
        await save({ broadcastEditorialPolicy: editorialPolicy });
      }
      await save({ phase: "send_broadcast" });
      await provider.sendBroadcast(existing.id);
      await save({ phase: "reconcile_broadcast" });
      existing = await provider.getBroadcast(existing.id);
    }
    if (!["sent", "queued", "sending", "scheduled"].includes(existing.status)) {
      throw new Error(`Unexpected broadcast status: ${existing.status || "missing"}.`);
    }
    await save({
      status: existing.status === "sent" ? "sent" : "submitted",
      phase: existing.status === "sent" ? "complete" : "provider_pending",
      providerStatus: existing.status, broadcastId: existing.id,
      ...(existing.sent_at ? { sentAt: existing.sent_at } : {})
    });
  });
}
