import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  TAP_SLOP,
  TILT_PER_PX,
  cardVerdict,
  dealNew,
  excerpt,
  leadImage,
  remainingCards,
  throwProgress,
  type CardVerdict,
} from "../cards";
import { formatListDate } from "../format";
import { FeedIcon } from "./FeedIcon";

import type { Entry } from "../types";

export type Decision = Exclude<CardVerdict, "none">;

interface Props {
  /** The list on screen, live: statuses and stars are read from it. */
  entries: Entry[];
  isLoading: boolean;
  onDecide: (entry: Entry, decision: Decision) => void;
  /** Put back a decision; `wasStarred` says whether the star was already there. */
  onUndo: (entry: Entry, decision: Decision, wasStarred: boolean) => void;
  onOpen: (entry: Entry) => void;
  onClose: () => void;
}

interface Decided {
  entry: Entry;
  decision: Decision;
  wasStarred: boolean;
}

/** How many cards are in the DOM: the top one and two peeking out beneath. */
const VISIBLE = 3;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Triage a list one card at a time: throw left to mark read, right to star.
 *
 * The deck is dealt once, from the unread articles on screen, and then keeps
 * its own order — see remainingCards for why.
 */
export function CardDeck({ entries, isLoading, onDecide, onUndo, onOpen, onClose }: Props) {
  const [dealt, setDealt] = useState<Entry[]>(() => dealNew([], entries));
  const [decided, setDecided] = useState<ReadonlySet<number>>(() => new Set());
  const [history, setHistory] = useState<Decided[]>([]);
  /** A card coming back from an undo, and which side it flies in from. */
  const [returning, setReturning] = useState<{ id: number; from: Decision }>();
  const stackRef = useRef<HTMLDivElement>(null);
  /** The top card's own thrower, so the buttons can do what a thumb does. */
  const throwTop = useRef<((decision: Decision) => void) | undefined>(undefined);

  useEffect(() => {
    setDealt((current) => dealNew(current, entries));
  }, [entries]);

  const cards = remainingCards(dealt, entries, decided);
  const top = cards[0];

  // A new card on top: the one beneath has already risen to full size during
  // the throw, so the lift is dropped in the same frame it takes over — with
  // transitions off, or it would visibly shrink back and grow again.
  useLayoutEffect(() => {
    const deck = stackRef.current;
    if (!deck) return;
    deck.classList.add("dragging");
    deck.style.setProperty("--lift", "0");
    const frame = requestAnimationFrame(() => deck.classList.remove("dragging"));
    return () => cancelAnimationFrame(frame);
  }, [top?.id]);

  const decide = useCallback(
    (entry: Entry, decision: Decision) => {
      setDecided((current) => new Set(current).add(entry.id));
      setHistory((current) => [...current, { entry, decision, wasStarred: entry.starred }]);
      setReturning(undefined);
      onDecide(entry, decision);
    },
    [onDecide],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((current) => current.slice(0, -1));
    setDecided((current) => {
      const next = new Set(current);
      next.delete(last.entry.id);
      return next;
    });
    // Back on top of the deck, whatever order it was dealt in.
    setDealt((current) => [last.entry, ...current.filter((entry) => entry.id !== last.entry.id)]);
    setReturning({ id: last.entry.id, from: last.decision });
    onUndo(last.entry, last.decision, last.wasStarred);
  }, [history, onUndo]);

  const open = useCallback(
    (entry: Entry) => {
      // Opening reads it, so it is done with as far as the deck is concerned.
      setDecided((current) => new Set(current).add(entry.id));
      onOpen(entry);
    },
    [onOpen],
  );

  // Arrow keys, for a phone with a keyboard or a narrow desktop window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return;
      if (event.key === "ArrowLeft") throwTop.current?.("read");
      else if (event.key === "ArrowRight") throwTop.current?.("star");
      else if (event.key === "Backspace" || (event.key === "z" && (event.metaKey || event.ctrlKey)))
        undo();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo]);

  if (isLoading && cards.length === 0) {
    return <div className="deck"><div className="loading">Loading…</div></div>;
  }

  return (
    <div className="deck">
      <div className="deck-stack" ref={stackRef}>
        {cards.length === 0 ? (
          <div className="deck-done">
            <div className="deck-done-mark" aria-hidden="true">✓</div>
            <p>Nothing left to sort here.</p>
            <button className="btn" onClick={onClose}>
              Back to the list
            </button>
          </div>
        ) : (
          // Bottom card first, so the top one paints last and takes the touches.
          cards
            .slice(0, VISIBLE)
            .map((entry, depth) => (
              <DeckCard
                key={entry.id}
                entry={entry}
                depth={depth}
                stack={stackRef}
                enterFrom={returning?.id === entry.id ? returning.from : undefined}
                onThrown={decide}
                onTap={open}
                registerThrow={depth === 0 ? throwTop : undefined}
              />
            ))
            .reverse()
        )}
      </div>

      <div className="deck-actions">
        <button
          className="deck-btn deck-btn-small"
          aria-label="Undo"
          title="Undo"
          disabled={history.length === 0}
          onClick={undo}
        >
          ↶
        </button>
        <button
          className="deck-btn deck-btn-read"
          aria-label="Mark read"
          title="Mark read (swipe left)"
          disabled={!top}
          onClick={() => throwTop.current?.("read")}
        >
          ✓
        </button>
        <button
          className="deck-btn deck-btn-star"
          aria-label="Star"
          title="Star (swipe right)"
          disabled={!top}
          onClick={() => throwTop.current?.("star")}
        >
          ★
        </button>
        <span className="deck-count" aria-live="polite">
          {cards.length}
          <span className="deck-count-label"> left</span>
        </span>
      </div>
    </div>
  );
}

interface CardProps {
  entry: Entry;
  /** 0 is the top card; deeper cards sit smaller and lower. */
  depth: number;
  stack: React.RefObject<HTMLDivElement | null>;
  enterFrom?: Decision;
  onThrown: (entry: Entry, decision: Decision) => void;
  onTap: (entry: Entry) => void;
  registerThrow?: React.MutableRefObject<((decision: Decision) => void) | undefined>;
}

/**
 * One card. Only the top one listens to the pointer.
 *
 * The drag writes transforms straight to the element rather than through
 * React state: re-rendering on every pointermove is what makes a swipe feel
 * like it is dragging through treacle.
 */
function DeckCard({ entry, depth, stack, enterFrom, onThrown, onTap, registerThrow }: CardProps) {
  const ref = useRef<HTMLElement>(null);
  const isTop = depth === 0;
  const image = leadImage(entry.content);
  const teaser = excerpt(entry.content);

  // The live list hands over a fresh entry object whenever anything in it
  // changes. Re-binding the drag for that would drop a gesture in progress, so
  // the handlers read the latest values from here instead.
  const latest = useRef({ entry, onThrown, onTap });
  useEffect(() => {
    latest.current = { entry, onThrown, onTap };
  });

  // Fly back in from the side it left by, after an undo.
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !enterFrom || reducedMotion()) return;
    const side = enterFrom === "star" ? 1 : -1;
    card.style.transition = "none";
    card.style.transform = `translate(${side * card.offsetWidth * 1.4}px, 0) rotate(${side * 25}deg)`;
    // Read layout so the starting position is committed before animating away from it.
    void card.offsetWidth;
    card.style.transition = "transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1.1)";
    card.style.transform = "";
  }, [enterFrom]);

  useEffect(() => {
    const card = ref.current;
    const deck = stack.current;
    if (!card || !deck || !isTop) return;

    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let moved = false;
    /** Recent samples, for the release velocity. */
    let samples: { x: number; t: number }[] = [];
    let thrown = false;

    const paint = (x: number, y: number) => {
      const progress = throwProgress(x, card.offsetWidth);
      const tilt = reducedMotion() ? 0 : x * TILT_PER_PX;
      card.style.transform = `translate(${x}px, ${y}px) rotate(${tilt}deg)`;
      card.style.setProperty("--throw", progress.toFixed(3));
      deck.style.setProperty("--lift", Math.abs(progress).toFixed(3));
    };

    const settle = () => {
      deck.classList.remove("dragging");
      card.style.transition = reducedMotion()
        ? "transform 120ms ease-out"
        : // A little overshoot, so it lands like something with weight.
          "transform 380ms cubic-bezier(0.2, 1.5, 0.4, 1)";
      card.style.transform = "";
      card.style.setProperty("--throw", "0");
      deck.style.setProperty("--lift", "0");
    };

    const fling = (decision: Decision, fromY = 0) => {
      if (thrown) return;
      thrown = true;
      const side = decision === "star" ? 1 : -1;
      const distance = Math.max(window.innerWidth, card.offsetWidth) * 1.3;
      const quick = reducedMotion();

      deck.classList.remove("dragging");
      deck.classList.add("throwing");
      card.style.transition = quick
        ? "transform 120ms ease-in, opacity 120ms ease-in"
        : "transform 300ms cubic-bezier(0.4, 0, 0.8, 0.6), opacity 300ms ease-in";
      card.style.setProperty("--throw", String(side));
      deck.style.setProperty("--lift", "1");
      card.style.transform = `translate(${side * distance}px, ${fromY * 1.5}px) rotate(${
        quick ? 0 : side * 30
      }deg)`;
      card.style.opacity = "0";

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        deck.classList.remove("throwing");
        latest.current.onThrown(latest.current.entry, decision);
      };
      card.addEventListener("transitionend", finish, { once: true });
      // transitionend does not fire for a hidden tab or a skipped animation.
      window.setTimeout(finish, quick ? 160 : 360);
    };

    if (registerThrow) registerThrow.current = (decision) => fling(decision);

    const onPointerDown = (event: PointerEvent) => {
      if (thrown || pointerId !== -1 || event.button > 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dx = 0;
      dy = 0;
      moved = false;
      samples = [{ x: event.clientX, t: event.timeStamp }];
      card.style.transition = "none";
      deck.classList.add("dragging");
      try {
        card.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; the drag still works without it.
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      dx = event.clientX - startX;
      dy = event.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > TAP_SLOP) moved = true;
      samples.push({ x: event.clientX, t: event.timeStamp });
      // Only the last ~100ms says how fast the finger was going when it let go.
      while (samples.length > 2 && event.timeStamp - samples[0].t > 100) samples.shift();
      if (moved) paint(dx, dy);
    };

    const release = (event: PointerEvent, cancelled: boolean) => {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      try {
        card.releasePointerCapture(event.pointerId);
      } catch {
        // Already released.
      }

      if (cancelled) {
        settle();
        return;
      }
      if (!moved) {
        deck.classList.remove("dragging");
        latest.current.onTap(latest.current.entry);
        return;
      }

      const first = samples[0];
      const last = samples[samples.length - 1];
      const elapsed = last.t - first.t;
      const vx = elapsed > 0 ? (last.x - first.x) / elapsed : 0;

      const verdict = cardVerdict({ dx, vx, width: card.offsetWidth });
      if (verdict === "none") settle();
      else fling(verdict, dy);
    };

    const onPointerUp = (event: PointerEvent) => release(event, false);
    const onPointerCancel = (event: PointerEvent) => release(event, true);

    card.addEventListener("pointerdown", onPointerDown);
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerup", onPointerUp);
    card.addEventListener("pointercancel", onPointerCancel);

    return () => {
      if (registerThrow) registerThrow.current = undefined;
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", onPointerUp);
      card.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [entry.id, isTop, stack, registerThrow]);

  return (
    <article
      ref={ref}
      className="deck-card"
      data-depth={depth}
      aria-hidden={!isTop}
      aria-label={isTop ? entry.title : undefined}
    >
      <div className="deck-stamp deck-stamp-read" aria-hidden="true">
        Read
      </div>
      <div className="deck-stamp deck-stamp-star" aria-hidden="true">
        ★ Star
      </div>

      {image && (
        <img
          className="deck-image"
          src={image}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          // Hide a broken image rather than show its pictogram on the card.
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}

      <div className="deck-body">
        <div className="deck-feed">
          {entry.feed && <FeedIcon feedId={entry.feed.id} hasIcon />}
          <span className="deck-feed-name">{entry.feed?.title}</span>
          {entry.starred && <span className="star">★</span>}
        </div>
        <h2 className="deck-title">{entry.title}</h2>
        {teaser && <p className="deck-teaser">{teaser}</p>}
        <div className="deck-meta">
          <span>{formatListDate(entry.published_at)}</span>
          {entry.reading_time > 0 && <span>{entry.reading_time} min read</span>}
          {entry.author && <span className="deck-author">{entry.author}</span>}
        </div>
      </div>
    </article>
  );
}
