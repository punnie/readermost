import { describe, expect, it } from "vitest";

import { DEFAULT_READING_PREFS, parseReadingPrefs } from "./reading";

describe("parseReadingPrefs", () => {
  it("keeps a valid set as it is", () => {
    const prefs = { font_family: "opendyslexic", text_size: "xlarge", density: "spacious" };
    expect(parseReadingPrefs(prefs)).toEqual(prefs);
  });

  it("defaults anything that is not prefs at all", () => {
    expect(parseReadingPrefs(undefined)).toEqual(DEFAULT_READING_PREFS);
    expect(parseReadingPrefs(null)).toEqual(DEFAULT_READING_PREFS);
    expect(parseReadingPrefs("serif")).toEqual(DEFAULT_READING_PREFS);
  });

  // A value a newer server added, or an older one dropped, must not cost the
  // reader the choices that are still good.
  it("replaces only the fields it does not recognise", () => {
    expect(
      parseReadingPrefs({ font_family: "papyrus", text_size: "large", density: 3 }),
    ).toEqual({
      font_family: DEFAULT_READING_PREFS.font_family,
      text_size: "large",
      density: DEFAULT_READING_PREFS.density,
    });
  });
});
