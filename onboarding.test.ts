/**
 * ONBOARDING: what the studio asks before anything is provisioned, and what the engine will take.
 *
 * The owner's words: *"remove the thing about where it should post just put icons for aesthetics
 * and when the template onboarding starts it can do it."* So no question asks where the channel
 * posts: it posts to the accounts connected to it, and the channel manager asks for one when none
 * is. The networks survive only as static metadata the studio draws beside the title. The answers
 * land on the install and every seat reads them with `project_context`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declaration } from "./naive.config.ts";
import { TEMPLATES } from "./templates/index.ts";
import { PLATFORMS, REFERENCE_ANSWER_KEY, REFERENCE_QUESTION, VISIBILITY_QUESTION } from "./templates/template.ts";

const all = Object.values(TEMPLATES);

describe("where the channel posts", () => {
  it("is never asked: no template carries a question about networks", () => {
    for (const template of all) {
      for (const question of template.questions) {
        expect(`${question.key} ${question.label}`, template.name).not.toMatch(/platform|network|where .*post/i);
      }
    }
  });

  it("is the connected accounts, so the persona maps no answer to an account", () => {
    for (const identity of declaration.identities) expect(Object.keys(identity).sort()).toEqual(["description", "name"]);
  });

  /** Every post is a video; the platform's video-capable set (`SOCIAL_MEDIA_PLATFORMS`) is exactly these. */
  it("is pictured, not asked: every template is made for the three networks that take video", () => {
    expect([...PLATFORMS].sort()).toEqual(["instagram", "tiktok", "youtube"]);
    for (const template of all) expect(template.platforms, template.name).toBe(PLATFORMS);
  });
});

describe("the question form", () => {
  /** This test asks the real engine, so nobody has to re-derive the cap. */
  it("fits what the engine will actually install, and a fifth is refused by name", async () => {
    for (const template of all) {
      expect(template.questions.filter((q) => q.optional !== true).length, template.name).toBeLessThanOrEqual(3);
      expect(template.questions.length, template.name).toBeLessThanOrEqual(4);
    }
    const { defineProject } = await import("@usenaive-sdk/blueprints");
    const extra = { key: "extra", label: "One more thing", type: "text" as const };
    const over = { ...declaration, questions: [...declaration.questions, extra, extra] };
    expect(() => defineProject(over)).toThrow(/asks \d+ questions, but a template asks at most 4/);
    expect(() => defineProject(declaration)).not.toThrow();
  });

  /** The comment on the cap quotes the refusal and names the engine it was measured on. */
  it("says where the question limit actually comes from", () => {
    const source = readFileSync(new URL("./templates/template.ts", import.meta.url), "utf8");
    expect(source).toMatch(/a template asks at most 4 before anything is/);
  });
});

describe("the question that asks what to model the channel on", () => {
  it("is optional free text, asked only by the templates that generate video", () => {
    expect(REFERENCE_QUESTION.optional).toBe(true);
    expect(REFERENCE_QUESTION.type).toBe("text");
    expect(REFERENCE_QUESTION.key).toBe(REFERENCE_ANSWER_KEY);
    expect(TEMPLATES.faceless.questions).toContain(REFERENCE_QUESTION);
    expect(TEMPLATES.longform.questions).toContain(REFERENCE_QUESTION);
    // `clipping` names its sources instead, and means something stronger: cut from these only.
    expect(TEMPLATES.clipping.questions).not.toContain(REFERENCE_QUESTION);
  });

  /** Second, so the form reads as what the channel is, what it is like, how often. */
  it("is asked after the niche and before the cadence", () => {
    expect(TEMPLATES.faceless.questions.map((q) => q.key)).toEqual(["niche", REFERENCE_ANSWER_KEY, "cadence"]);
    expect(TEMPLATES.longform.questions.map((q) => q.key)).toEqual(["niche", REFERENCE_ANSWER_KEY, "cadence"]);
  });
});

/**
 * WHO SEES A NEW YOUTUBE VIDEO. The publisher posts YouTube `unlisted` unless the setup answer says
 * otherwise. Only `clipping` asks it; the generating templates spend their optional slot on the
 * reference.
 */
describe("the question that asks who sees a new YouTube video", () => {
  it("is optional, offers only what YouTube takes, and puts the safe default first", () => {
    expect(VISIBILITY_QUESTION.optional).toBe(true);
    expect(VISIBILITY_QUESTION.type).toBe("choice");
    if (VISIBILITY_QUESTION.type !== "choice") return;
    expect(VISIBILITY_QUESTION.options).toEqual(["Unlisted", "Public", "Private"]);
    expect(VISIBILITY_QUESTION.other).toBe(false);
    expect(VISIBILITY_QUESTION.help ?? "").toMatch(/YouTube only/);
  });

  it("is asked by clipping only, second", () => {
    expect(TEMPLATES.clipping.questions.map((q) => q.key)).toEqual(["sources", "visibility", "cadence"]);
    expect(TEMPLATES.faceless.questions).not.toContain(VISIBILITY_QUESTION);
    expect(TEMPLATES.longform.questions).not.toContain(VISIBILITY_QUESTION);
  });
});
