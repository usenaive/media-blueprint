/**
 * Where the front door leads.
 *
 * `/` redirected to `/chat`, so the screen that sets a channel up — the only writer of the profile
 * every agent reads — was reachable by typing its path and no other way. A new deployment landed in
 * a chat with an empty channel behind it.
 */
import { describe, expect, it } from "vitest";
import { landingPath } from "./Onboarding";
import { ACTIVE } from "../../templates";

const answered = Object.fromEntries(ACTIVE.questions.map((question) => [question.key, "stoicism"]));

describe("landingPath", () => {
  it("sets a channel up before letting anyone in", () => {
    expect(landingPath({})).toBe("/onboarding");
    expect(landingPath(Object.fromEntries(ACTIVE.questions.map((q) => [q.key, null])))).toBe("/onboarding");
    // A question answered with whitespace has not been answered.
    expect(landingPath(Object.fromEntries(ACTIVE.questions.map((q) => [q.key, "  "])))).toBe("/onboarding");
  });

  it("sends a channel that has answered to the chat", () => {
    expect(landingPath(answered)).toBe("/chat");
  });

  it("does not put a working channel back through setup because a read failed", () => {
    // `null` is "the server did not say", which is not the same as "nothing has been answered".
    expect(landingPath(null)).toBe("/chat");
  });
});
