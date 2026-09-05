import { afterEach, describe, expect, it } from "vitest";
import {
  parseBooleanValue,
  parseBoundedFloatValue,
  parseCommaEnumValue,
  parseIdValue,
  parseIsoDateValue,
  readEnumParam,
  readFlag,
  readFloatParam,
  readHeadingParam,
  readIdParam,
  readIntParam,
  readIsoDateParam,
  readSitePointParam,
} from "./params";
import { SITE_SIZE } from "./layout";
import { safeExternalHref } from "./safeUrl";

/**
 * `params.ts` reads `window.location.search`, so these tests install a minimal
 * `window` rather than a DOM. That is the whole surface the module touches, and
 * standing up jsdom to provide one property would make the suite slower and
 * test less.
 *
 * Every case here is an input someone can put in a link and hand to a stranger.
 * The module's three rules are what is under test: reject before clamp, bound
 * every number, never throw.
 */
function withSearch<T>(search: string, run: () => T): T {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { search } };
  try {
    return run();
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("readFlag", () => {
  it("accepts only 1 and true", () => {
    expect(withSearch("?a=1", () => readFlag("a"))).toBe(true);
    expect(withSearch("?a=true", () => readFlag("a"))).toBe(true);
    expect(withSearch("?a=yes", () => readFlag("a"))).toBe(false);
    expect(withSearch("?a=TRUE", () => readFlag("a"))).toBe(false);
    expect(withSearch("?a=", () => readFlag("a"))).toBe(false);
    expect(withSearch("", () => readFlag("a"))).toBe(false);
  });
});

describe("readIntParam", () => {
  it("clamps into range", () => {
    expect(withSearch("?q=9", () => readIntParam("q", 0, 3))).toBe(3);
    expect(withSearch("?q=-4", () => readIntParam("q", 0, 3))).toBe(0);
    expect(withSearch("?q=2", () => readIntParam("q", 0, 3))).toBe(2);
  });

  it("rejects rather than coerces the values that look valid to Number()", () => {
    // `Number("")` is 0 and `Number(" ")` is 0. Both would place a player at the
    // origin or pin quality tier 0 without anyone asking for it.
    expect(withSearch("?q=", () => readIntParam("q", 0, 3))).toBeNull();
    expect(withSearch("?q=%20", () => readIntParam("q", 0, 3))).toBeNull();
    expect(withSearch("?q=2.5", () => readIntParam("q", 0, 3))).toBeNull();
    expect(withSearch("?q=abc", () => readIntParam("q", 0, 3))).toBeNull();
  });

  it("rejects overflow rather than clamping it to the maximum", () => {
    // `Number("1e309")` is Infinity, which is not finite and so never reaches
    // the clamp. The tools throw exactly this at the app.
    expect(withSearch("?q=1e309", () => readIntParam("q", 0, 3))).toBeNull();
    expect(withSearch("?q=NaN", () => readIntParam("q", 0, 3))).toBeNull();
  });

  it("ignores an over-long value without reading it", () => {
    const long = "1".repeat(200);
    expect(withSearch(`?q=${long}`, () => readIntParam("q", 0, 3))).toBeNull();
  });
});

describe("readFloatParam", () => {
  it("clamps and rejects non-finite input", () => {
    expect(withSearch("?f=2.75", () => readFloatParam("f", 0, 1))).toBe(1);
    expect(withSearch("?f=-0.5", () => readFloatParam("f", 0, 1))).toBe(0);
    expect(withSearch("?f=1e400", () => readFloatParam("f", 0, 1))).toBeNull();
  });

  it("treats negative zero as zero rather than rejecting it", () => {
    expect(withSearch("?f=-0", () => readFloatParam("f", -1, 1))).toBe(-0);
  });
});

describe("readEnumParam", () => {
  it("accepts only exact members", () => {
    const allowed = ["orbit", "fps"] as const;
    expect(withSearch("?m=fps", () => readEnumParam("m", allowed))).toBe("fps");
    expect(withSearch("?m=FPS", () => readEnumParam("m", allowed))).toBeNull();
    expect(withSearch("?m=fps ", () => readEnumParam("m", allowed))).toBeNull();
    expect(withSearch("?m=constructor", () => readEnumParam("m", allowed))).toBeNull();
  });
});

describe("readIdParam", () => {
  it("accepts model slugs and nothing else", () => {
    expect(withSearch("?s=hangar-main", () => readIdParam("s"))).toBe("hangar-main");
    expect(withSearch("?s=Hangar", () => readIdParam("s"))).toBeNull();
    expect(withSearch("?s=-leading", () => readIdParam("s"))).toBeNull();
    expect(
      withSearch(`?s=${encodeURIComponent("<script>alert(1)</script>")}`, () =>
        readIdParam("s"),
      ),
    ).toBeNull();
    expect(
      withSearch(`?s=${encodeURIComponent("../../etc/passwd")}`, () => readIdParam("s")),
    ).toBeNull();
  });
});

describe("readSitePointParam", () => {
  it("clamps both components to the modeled site", () => {
    const limit = SITE_SIZE / 2;
    expect(withSearch("?at=1e308,-1e308", () => readSitePointParam("at"))).toEqual([
      limit,
      -limit,
    ]);
    expect(withSearch("?at=100,-200", () => readSitePointParam("at"))).toEqual([
      100, -200,
    ]);
  });

  it("rejects every partial form rather than reading it as the origin", () => {
    for (const value of ["", "1", ",", "1,", ",1", "1,foo", "1,2,3"]) {
      expect(withSearch(`?at=${value}`, () => readSitePointParam("at"))).toBeNull();
    }
  });
});

describe("readHeadingParam", () => {
  it("wraps into [0, 360)", () => {
    expect(withSearch("?look=370", () => readHeadingParam("look"))).toBe(10);
    expect(withSearch("?look=-90", () => readHeadingParam("look"))).toBe(270);
    expect(withSearch("?look=0", () => readHeadingParam("look"))).toBe(0);
    expect(withSearch("?look=notanumber", () => readHeadingParam("look"))).toBeNull();
  });
});

describe("readIsoDateParam", () => {
  it("accepts a real calendar date", () => {
    expect(withSearch("?d=2025-09-13", () => readIsoDateParam("d"))).toBe("2025-09-13");
    expect(withSearch("?d=2024-02-29", () => readIsoDateParam("d"))).toBe("2024-02-29");
  });

  it("rejects a date that does not exist rather than rolling it forward", () => {
    // `new Date("2025-02-30")` is 2 March. Accepting it would turn a typo into a
    // plausible-looking snapshot date pointing at the wrong day.
    expect(withSearch("?d=2025-02-30", () => readIsoDateParam("d"))).toBeNull();
    expect(withSearch("?d=2023-02-29", () => readIsoDateParam("d"))).toBeNull();
    expect(withSearch("?d=9999-99-99", () => readIsoDateParam("d"))).toBeNull();
  });

  it("rejects anything that is not an ISO calendar date", () => {
    for (const value of ["2025", "2025-9-13", "13/09/2025", "late 2025", "0"]) {
      expect(
        withSearch(`?d=${encodeURIComponent(value)}`, () => readIsoDateParam("d")),
      ).toBeNull();
    }
  });
});

describe("pure route-value parsers", () => {
  it("normalizes comma enum lists into allowed vocabulary order", () => {
    const allowed = ["aircraft", "apron", "pavement", "structure"] as const;
    expect(parseCommaEnumValue("structure,aircraft,structure", allowed)).toEqual([
      "aircraft",
      "structure",
    ]);
    expect(parseCommaEnumValue("", allowed)).toEqual([]);
    expect(parseCommaEnumValue("structure,unknown", allowed)).toBeNull();
    expect(parseCommaEnumValue("x".repeat(65), allowed)).toBeNull();
    expect(parseCommaEnumValue(["structure"], allowed)).toBeNull();
  });

  it("parses explicit booleans without truthy coercion", () => {
    expect(parseBooleanValue("1")).toBe(true);
    expect(parseBooleanValue("true")).toBe(true);
    expect(parseBooleanValue("0")).toBe(false);
    expect(parseBooleanValue("false")).toBe(false);
    expect(parseBooleanValue("yes")).toBeNull();
    expect(parseBooleanValue(undefined)).toBeNull();
  });

  it("rejects non-finite, negative, and out-of-range spatial thresholds", () => {
    expect(parseBoundedFloatValue("500", 0, SITE_SIZE)).toBe(500);
    expect(parseBoundedFloatValue("0", 0, SITE_SIZE)).toBe(0);
    expect(parseBoundedFloatValue("-1", 0, SITE_SIZE)).toBeNull();
    expect(parseBoundedFloatValue(String(SITE_SIZE + 1), 0, SITE_SIZE)).toBeNull();
    expect(parseBoundedFloatValue("1e309", 0, SITE_SIZE)).toBeNull();
    expect(parseBoundedFloatValue("", 0, SITE_SIZE)).toBeNull();
  });

  it("shares id and calendar-date rules with browser readers", () => {
    expect(parseIdValue("rwy-05-23")).toBe("rwy-05-23");
    expect(parseIdValue("../rwy")).toBeNull();
    expect(parseIdValue("a".repeat(65))).toBeNull();
    expect(parseIsoDateValue("2025-09-13")).toBe("2025-09-13");
    expect(parseIsoDateValue("2025-02-30")).toBeNull();
    expect(parseIsoDateValue("<script>")).toBeNull();
  });
});

describe("safeExternalHref", () => {
  it("passes HTTPS through", () => {
    expect(safeExternalHref("https://example.invalid/a")).toBe(
      "https://example.invalid/a",
    );
  });

  it("refuses every scheme that executes or embeds", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "http://example.invalid/a",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(safeExternalHref(url)).toBeUndefined();
    }
  });

  it("returns undefined for an absent URL", () => {
    expect(safeExternalHref(undefined)).toBeUndefined();
  });
});
