import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type TourStep = {
  // CSS selector for the element to spotlight. Omit for a centered card.
  target?: string;
  title: string;
  body: string;
  // Preferred side to place the tooltip relative to the target.
  side?: "top" | "bottom" | "left" | "right" | "center";
};

type Point = { top: number; left: number };

const TIP_WIDTH = 304;
const SPOTLIGHT_PAD = 8;

// A small, dependency-free product tour: it dims the screen, cuts a spotlight
// over the target element (via a large box-shadow), and floats an explanation
// card beside it. Steps whose target isn't currently visible are skipped, so
// the same script works on desktop and mobile.
export default function Tour({
  open,
  steps,
  onClose
}: {
  open: boolean;
  steps: TourStep[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tipPos, setTipPos] = useState<Point | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const visibleSteps = steps.filter((step) => !step.target || isVisible(step.target));
  const step = visibleSteps[index];
  const targetSelector = step?.target;
  const side = step?.side ?? "bottom";

  useEffect(() => {
    if (open) {
      setIndex(0);
    }
  }, [open]);

  // Move focus into the card when the tour opens. It auto-opens on first visit,
  // so without this a keyboard or screen-reader user gets a modal announced
  // while their focus is still somewhere behind it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      tipRef.current?.querySelector<HTMLElement>(".tour-next")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Measure the target and place the tooltip; keep it pinned on resize/scroll.
  useLayoutEffect(() => {
    if (!open || !step) {
      return;
    }
    const measure = () => {
      const element = targetSelector ? (document.querySelector(targetSelector) as HTMLElement | null) : null;
      const nextRect = element ? element.getBoundingClientRect() : null;
      const tipHeight = tipRef.current?.offsetHeight ?? 184;
      setRect(nextRect);
      setTipPos(computeTipPosition(nextRect, side, tipHeight));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // Primitive deps only, so this doesn't loop on each render's fresh `step`.
  }, [open, index, targetSelector, side, step]);

  // Esc closes; arrows navigate.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // Arrows only drive the tour when focus is inside its own card. The tour
      // spotlights the timeline, and a window-level handler here stole arrow
      // keys from the day-rail slider it was pointing at.
      const insideTip = tipRef.current?.contains(document.activeElement);
      if (!insideTip) {
        return;
      }
      if (event.key === "ArrowRight") {
        setIndex((current) => Math.min(current + 1, visibleSteps.length - 1));
      } else if (event.key === "ArrowLeft") {
        setIndex((current) => Math.max(current - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, visibleSteps.length]);

  if (!open || !step) {
    return null;
  }

  const atEnd = index >= visibleSteps.length - 1;
  const spotlightVisible = Boolean(rect && rect.width > 0);

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Flockline tour">
      <div className={`tour-catch ${spotlightVisible ? "" : "dim"}`} onClick={onClose} />
      {spotlightVisible && rect ? (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2
          }}
        />
      ) : null}

      <div
        className="tour-tip"
        ref={tipRef}
        style={
          tipPos
            ? { top: tipPos.top, left: tipPos.left }
            : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
        }
      >
        <button type="button" className="tour-close" onClick={onClose} aria-label="Close tour">
          <X size={16} />
        </button>
        <span className="tour-count">
          {index + 1} of {visibleSteps.length}
        </span>
        <h3>{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={onClose}>
            Skip
          </button>
          <div className="tour-nav">
            {index > 0 ? (
              <button type="button" className="tour-back" onClick={() => setIndex((current) => current - 1)}>
                Back
              </button>
            ) : null}
            <button
              type="button"
              className="tour-next"
              onClick={() => (atEnd ? onClose() : setIndex((current) => current + 1))}
            >
              {atEnd ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function isVisible(selector: string) {
  const element = document.querySelector(selector);
  return Boolean(element && element.getClientRects().length > 0);
}

function computeTipPosition(rect: DOMRect | null, side: string, tipHeight: number): Point {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 14;
  const margin = 16;

  if (!rect || side === "center") {
    return { top: Math.max(margin, vh / 2 - tipHeight / 2), left: Math.max(margin, vw / 2 - TIP_WIDTH / 2) };
  }

  const clampLeft = (value: number) => Math.min(Math.max(value, margin), vw - TIP_WIDTH - margin);
  const clampTop = (value: number) => Math.min(Math.max(value, margin), vh - tipHeight - margin);
  const centerLeft = clampLeft(rect.left + rect.width / 2 - TIP_WIDTH / 2);

  if (side === "right" && rect.right + TIP_WIDTH + gap <= vw) {
    return { top: clampTop(rect.top), left: rect.right + gap };
  }
  if (side === "left" && rect.left - TIP_WIDTH - gap >= 0) {
    return { top: clampTop(rect.top), left: rect.left - TIP_WIDTH - gap };
  }
  if (side === "top" && rect.top - tipHeight - gap >= 0) {
    return { top: rect.top - tipHeight - gap, left: centerLeft };
  }
  if (rect.bottom + tipHeight + gap <= vh) {
    return { top: rect.bottom + gap, left: centerLeft };
  }
  if (rect.top - tipHeight - gap >= 0) {
    return { top: rect.top - tipHeight - gap, left: centerLeft };
  }
  if (rect.right + TIP_WIDTH + gap <= vw) {
    return { top: clampTop(rect.top), left: rect.right + gap };
  }
  return { top: clampTop(rect.top), left: clampLeft(rect.left) };
}
