import { Check, LoaderCircle, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { US_REGION_PRESETS } from "../shared/usGeography.js";

type DigestSignupProps = {
  defaultRegionId: string;
  variant?: "card" | "header";
};

type SignupState = "idle" | "sending" | "sent";

export default function DigestSignup({ defaultRegionId, variant = "card" }: DigestSignupProps) {
  const validDefault = US_REGION_PRESETS.some((region) => region.id === defaultRegionId)
    ? defaultRegionId
    : "nationwide";
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [selectedRegions, setSelectedRegions] = useState([validDefault]);
  const [state, setState] = useState<SignupState>("idle");
  const [error, setError] = useState("");

  const selectedNames = US_REGION_PRESETS
    .filter((region) => selectedRegions.includes(region.id))
    .map((region) => region.name);
  const variantClass = variant === "header" ? "digest-header" : "";

  const toggleRegion = (regionId: string) => {
    setError("");
    setSelectedRegions((current) => current.includes(regionId)
      ? current.filter((id) => id !== regionId)
      : [...current, regionId]);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRegions.length) {
      setError("Choose at least one regional edition.");
      return;
    }

    setState("sending");
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/digest-subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          regions: selectedRegions,
          website: form.get("website")
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || "The confirmation email could not be sent.");
      }
      setState("sent");
    } catch (requestError) {
      setState("idle");
      setError(requestError instanceof Error
        ? requestError.message
        : "The confirmation email could not be sent.");
    }
  };

  if (state === "sent") {
    return (
      <section className={`digest-signup success ${variantClass}`} aria-live="polite">
        <div className="digest-success-content">
          <Check aria-hidden="true" />
          <div>
            <strong>Check your inbox</strong>
            <p>
              Confirm your address to receive {formatList(selectedNames)} every Monday at 10 AM ET.
            </p>
            <button type="button" onClick={() => setState("idle")}>Use a different email</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`digest-signup ${variantClass} ${open ? "open" : ""}`}>
      {!open ? (
        <button
          type="button"
          className="digest-cta"
          onClick={() => setOpen(true)}
          aria-expanded="false"
        >
          <Mail aria-hidden="true" />
          <span>
            <strong>{variant === "header" ? "Get weekly insights" : "Get weekly insights by email"}</strong>
            {variant === "card" ? <small>10 AM ET every Monday · choose any region</small> : null}
          </span>
        </button>
      ) : (
        <form onSubmit={(event) => void submit(event)} aria-label="Weekly insights signup">
          <div className="digest-form-heading">
            <Mail aria-hidden="true" />
            <div>
              <strong>Your Monday field note</strong>
              <p>Each selected edition arrives at 10 AM ET as a separate email.</p>
            </div>
          </div>

          <fieldset>
            <legend>Choose regional editions</legend>
            <div className="digest-region-options">
              {US_REGION_PRESETS.map((region) => (
                <label key={region.id}>
                  <input
                    type="checkbox"
                    checked={selectedRegions.includes(region.id)}
                    onChange={() => toggleRegion(region.id)}
                  />
                  <span>{region.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="digest-email-field">
            <span>Email address</span>
            <input
              type="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label className="digest-honeypot" aria-hidden="true">
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>

          {error ? <p className="digest-error" role="alert">{error}</p> : null}

          <div className="digest-form-actions">
            <button
              type="submit"
              className="digest-submit"
              disabled={state === "sending" || !selectedRegions.length}
            >
              {state === "sending" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Mail aria-hidden="true" />}
              {state === "sending" ? "Sending…" : "Send confirmation"}
            </button>
            <button type="button" className="digest-cancel" onClick={() => setOpen(false)}>
              Not now
            </button>
          </div>
          <p className="digest-consent">
            Confirming subscribes you to the editions selected above. Every digest includes a
            preference and unsubscribe link.
          </p>
        </form>
      )}
    </section>
  );
}

function formatList(items: string[]) {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
}
