import { describe, expect, it } from "vitest";

import {
  FLING_MIN_DISTANCE,
  FLING_VELOCITY,
  THROW_FRACTION,
  cardVerdict,
  dealNew,
  excerpt,
  leadImage,
  remainingCards,
  throwProgress,
} from "./cards";
import type { Entry } from "./types";

const WIDTH = 400;

function entry(id: number, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    feed_id: 1,
    status: "unread",
    title: `Entry ${id}`,
    url: `https://example.com/${id}`,
    comments_url: "",
    author: "",
    content: "",
    published_at: "2026-10-01T00:00:00Z",
    starred: false,
    reading_time: 1,
    ...overrides,
  };
}

describe("cardVerdict", () => {
  it("throws left to read and right to star", () => {
    expect(cardVerdict({ dx: -WIDTH, vx: 0, width: WIDTH })).toBe("read");
    expect(cardVerdict({ dx: WIDTH, vx: 0, width: WIDTH })).toBe("star");
  });

  it("puts a slow, short drag back", () => {
    const short = WIDTH * THROW_FRACTION - 1;
    expect(cardVerdict({ dx: short, vx: 0.1, width: WIDTH })).toBe("none");
    expect(cardVerdict({ dx: -short, vx: -0.1, width: WIDTH })).toBe("none");
  });

  it("counts a slow drag once it is far enough", () => {
    expect(cardVerdict({ dx: WIDTH * THROW_FRACTION, vx: 0, width: WIDTH })).toBe("star");
  });

  it("counts a quick flick even when it is short", () => {
    expect(cardVerdict({ dx: -FLING_MIN_DISTANCE, vx: -FLING_VELOCITY, width: WIDTH })).toBe(
      "read",
    );
  });

  it("does not count a twitch, however fast", () => {
    expect(cardVerdict({ dx: FLING_MIN_DISTANCE - 1, vx: 3, width: WIDTH })).toBe("none");
  });

  it("treats snapping back as changing your mind", () => {
    // Dragged right, then flicked back left before letting go.
    expect(cardVerdict({ dx: 60, vx: -2, width: WIDTH })).toBe("none");
  });
});

describe("throwProgress", () => {
  it("runs from -1 to 1 and saturates", () => {
    expect(throwProgress(0, WIDTH)).toBe(0);
    expect(throwProgress(WIDTH * THROW_FRACTION, WIDTH)).toBe(1);
    expect(throwProgress(-WIDTH * 5, WIDTH)).toBe(-1);
  });

  it("survives a card that has not been measured yet", () => {
    expect(throwProgress(50, 0)).toBe(0);
  });
});

describe("remainingCards", () => {
  it("keeps the dealt order, whatever the live list does", () => {
    const dealt = [entry(1), entry(2), entry(3)];
    const live = [entry(3), entry(1), entry(2)];
    expect(remainingCards(dealt, live, new Set()).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("drops what has been decided and what was read elsewhere", () => {
    const dealt = [entry(1), entry(2), entry(3)];
    const live = [entry(1), entry(2, { status: "read" }), entry(3)];
    expect(remainingCards(dealt, live, new Set([1])).map((e) => e.id)).toEqual([3]);
  });

  it("shows the live copy, so a star made elsewhere shows up", () => {
    const dealt = [entry(1)];
    const live = [entry(1, { starred: true })];
    expect(remainingCards(dealt, live, new Set())[0].starred).toBe(true);
  });

  it("keeps a card that has left the live list but was never decided", () => {
    // An undone swipe can be refetched away before the undo lands.
    expect(remainingCards([entry(1)], [], new Set()).map((e) => e.id)).toEqual([1]);
  });
});

describe("dealNew", () => {
  it("adds new unread entries at the back", () => {
    const dealt = [entry(2)];
    const live = [entry(1), entry(2), entry(3, { status: "read" })];
    expect(dealNew(dealt, live).map((e) => e.id)).toEqual([2, 1]);
  });

  it("returns the same deck when nothing is new, so state does not churn", () => {
    const dealt = [entry(1)];
    expect(dealNew(dealt, [entry(1)])).toBe(dealt);
  });
});

describe("excerpt", () => {
  it("strips markup and decodes entities", () => {
    expect(excerpt("<p>Fish &amp; chips&nbsp;&#8212; <b>hot</b></p>")).toBe("Fish & chips — hot");
  });

  it("leaves out code and captions", () => {
    expect(excerpt("<p>Intro</p><pre>rm -rf /</pre><figure><img><figcaption>x</figcaption></figure>")).toBe(
      "Intro",
    );
  });

  it("cuts at a word", () => {
    const text = "word ".repeat(100);
    const result = excerpt(text, 50);
    expect(result.endsWith("word…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(51);
  });
});

describe("leadImage", () => {
  it("finds the first real image", () => {
    expect(
      leadImage('<p>x</p><img src="https://e.com/a.jpg?w=1&amp;h=2"><img src="https://e.com/b.jpg">'),
    ).toBe("https://e.com/a.jpg?w=1&h=2");
  });

  it("skips tracking pixels and relative sources", () => {
    expect(
      leadImage(
        '<img src="/local.png"><img src="https://t.com/p.gif" width="1" height="1"><img src="https://e.com/c.png">',
      ),
    ).toBe("https://e.com/c.png");
  });

  it("returns nothing when there is no image", () => {
    expect(leadImage("<p>Just words</p>")).toBeUndefined();
  });
});
