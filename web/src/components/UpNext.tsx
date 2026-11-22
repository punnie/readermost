import { ArrowDown, List } from "lucide-react";

import { PULL_THRESHOLD, pullArmed, pullFor } from "../scrolling";

export interface NextItem {
  title: string;
  source?: string;
  minutes?: number;
}

interface Props {
  next?: NextItem;
  /** The finger's travel past the end of the article, while pulling. */
  pull: number;
  onAdvance: () => void;
  onBackToList: () => void;
}

/**
 * The end of an article on a phone: what comes next, reached by carrying on
 * the same scroll that got you here — or a tap.
 */
export function UpNext({ next, pull, onAdvance, onBackToList }: Props) {
  if (!next) {
    return (
      <div className="up-next up-next-end">
        <p>That's the last one in this list.</p>
        <button className="btn" onClick={onBackToList}>
          <List size={15} aria-hidden="true" />
          Back to the list
        </button>
      </div>
    );
  }

  const armed = pullArmed(pull);
  const fill = Math.min(1, pull / PULL_THRESHOLD);

  return (
    <button
      className={`up-next ${pull > 0 ? "pulling" : ""} ${armed ? "armed" : ""}`}
      style={{ transform: pull > 0 ? `translateY(${-pullFor(pull)}px)` : undefined }}
      onClick={onAdvance}
    >
      <span className="up-next-label">
        <span
          className="up-next-ring"
          style={{ ["--fill" as string]: `${fill * 360}deg` }}
          aria-hidden="true"
        >
          <ArrowDown size={14} />
        </span>
        {armed ? "Release for the next article" : "Up next"}
      </span>
      <span className="up-next-title">{next.title}</span>
      {(next.source || next.minutes) && (
        <span className="up-next-meta">
          {next.source}
          {next.source && next.minutes ? " · " : ""}
          {next.minutes ? `${next.minutes} min read` : ""}
        </span>
      )}
    </button>
  );
}
