import { describe, expect, it } from "vitest";

import { chooseGaleSubmitSelector, shouldFollowGaleNextPage } from "./gale.js";

describe("gale live helpers", () => {
  it("prefers the legacy homepage submit control when present", () => {
    expect(
      chooseGaleSubmitSelector([
        { tag: "INPUT", id: "homepage_submit", type: "submit" },
        { tag: "INPUT", id: "", type: "submit" },
      ]),
    ).toBe("#homepage_submit");
  });

  it("falls back to a submit input inside quickSearchForm when the legacy id is missing", () => {
    expect(
      chooseGaleSubmitSelector([
        { tag: "INPUT", id: "inputFieldValue_0", type: "text" },
        { tag: "INPUT", id: "", type: "submit" },
      ]),
    ).toBe('#quickSearchForm input[type="submit"]');
  });

  it("falls back to a submit button inside quickSearchForm before using raw form submission", () => {
    expect(
      chooseGaleSubmitSelector([
        { tag: "INPUT", id: "inputFieldValue_0", type: "text" },
        { tag: "BUTTON", id: "", type: "submit" },
      ]),
    ).toBe('#quickSearchForm button[type="submit"]');
  });

  it("returns null when no clickable submit control is visible", () => {
    expect(
      chooseGaleSubmitSelector([
        { tag: "INPUT", id: "inputFieldValue_0", type: "text" },
        { tag: "INPUT", id: "", type: "hidden" },
      ]),
    ).toBeNull();
  });

  it("does not follow the next page when the max-pages cap is already reached", () => {
    expect(shouldFollowGaleNextPage({ maxPages: 1, pagesScanned: 1, nextHref: "https://example.com/next" })).toBe(
      false,
    );
  });

  it("follows the next page only when a next href exists and the cap is not reached", () => {
    expect(shouldFollowGaleNextPage({ maxPages: 2, pagesScanned: 1, nextHref: "https://example.com/next" })).toBe(
      true,
    );
    expect(shouldFollowGaleNextPage({ maxPages: 0, pagesScanned: 5, nextHref: "" })).toBe(false);
  });
});
