import { useEffect, type ReactNode } from "react";

import { useReadingPrefs, useSetReadingPrefs } from "../hooks";
import {
  ACCENTS,
  ACCENT_LABELS,
  DEFAULT_READING_PREFS,
  DENSITIES,
  DENSITY_LABELS,
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  TEXT_SIZES,
  TEXT_SIZE_LABELS,
  UNREAD_MARKS,
  UNREAD_MARK_LABELS,
  type ReadingPrefs,
} from "../reading";

interface Props {
  onClose: () => void;
}

interface ChoiceProps<T extends string> {
  legend: string;
  name: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  /** Lets a font option be shown in its own typeface. */
  optionAttrs?: (option: T) => Record<string, string>;
  /** Drawn before an option's label, such as a colour swatch. */
  optionPrefix?: (option: T) => ReactNode;
  className?: string;
}

/** One row of mutually exclusive options; real radios, so arrow keys work. */
function Choice<T extends string>({
  legend,
  name,
  options,
  labels,
  value,
  onChange,
  optionAttrs,
  optionPrefix,
  className = "",
}: ChoiceProps<T>) {
  return (
    <fieldset className="reading-choice">
      <legend>{legend}</legend>
      <div className={`segmented ${className}`}>
        {options.map((option) => (
          <label
            key={option}
            className={option === value ? "selected" : ""}
            {...optionAttrs?.(option)}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
            />
            {optionPrefix?.(option)}
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The accent colour of the app, how unread items are marked, and the typeface,
 * size and spacing of articles and discussions.
 *
 * Every choice takes effect as it is made — the app behind the dialog is the
 * preview — and is saved to the account, so other devices follow.
 */
export function ReadingSettings({ onClose }: Props) {
  const prefs = useReadingPrefs(true);
  const save = useSetReadingPrefs();
  const current = prefs.data ?? DEFAULT_READING_PREFS;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const change = (patch: Partial<ReadingPrefs>) => save.mutate({ ...current, ...patch });

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog reading-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-title"
      >
        <h3 id="reading-title">Appearance</h3>

        <Choice
          legend="Accent colour"
          name="accent"
          options={ACCENTS}
          labels={ACCENT_LABELS}
          value={current.accent}
          onChange={(accent) => change({ accent })}
          optionAttrs={(accent) => ({ "data-accent-sample": accent })}
          optionPrefix={() => <span className="swatch" aria-hidden="true" />}
          className="swatches"
        />
        <Choice
          legend="Unread items"
          name="unread_mark"
          options={UNREAD_MARKS}
          labels={UNREAD_MARK_LABELS}
          value={current.unread_mark}
          onChange={(unread_mark) => change({ unread_mark })}
        />
        <Choice
          legend="Font"
          name="font_family"
          options={FONT_FAMILIES}
          labels={FONT_FAMILY_LABELS}
          value={current.font_family}
          onChange={(font_family) => change({ font_family })}
          optionAttrs={(font) => ({ "data-font-sample": font })}
        />
        <Choice
          legend="Text size"
          name="text_size"
          options={TEXT_SIZES}
          labels={TEXT_SIZE_LABELS}
          value={current.text_size}
          onChange={(text_size) => change({ text_size })}
        />
        <Choice
          legend="Density"
          name="density"
          options={DENSITIES}
          labels={DENSITY_LABELS}
          value={current.density}
          onChange={(density) => change({ density })}
        />

        <div className="reading-preview article-body" aria-hidden="true">
          <p>
            The quick brown fox jumps over the lazy dog. Shared links and their discussions
            will read like this.
          </p>
          <p>A second paragraph shows the spacing between them.</p>
        </div>

        <p className="subs-hint">
          The font, size and density apply to articles and discussions. Everything here
          follows you to your other devices.
        </p>

        {save.isError && (
          <div className="error-banner" style={{ marginTop: "8px" }}>
            {save.error instanceof Error ? save.error.message : "Could not save that change"}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
