/**
 * ONBOARDING: what the studio asks before anything is provisioned, and what the engine will take.
 *
 * The owner's words: *"one of the onboarding questions for the template should be which platforms
 * to do it on, the user needs to connect them, and then it can actually operate on it."* The answers
 * land on the install and every seat reads them with `project_context`; nothing in this repo
 * interprets them in code any more.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declaration } from "./naive.config.ts";
import { TEMPLATES } from "./templates/index.ts";
import { PLATFORM_ANSWER_KEY, PLATFORM_CHOICES, PLATFORM_QUESTION, REFERENCE_ANSWER_KEY, REFERENCE_QUESTION } from "./templates/template.ts";

const all = Object.values(TEMPLATES);

describe("the question that asks where the channel posts", () => {
  /** Every post is a video; the platform's video-capable set (`SOCIAL_MEDIA_PLATFORMS`) is exactly these. */
  it("offers the three networks that take video, and nothing a customer could type", () => {
    expect(PLATFORM_CHOICES.map((choice) => choice.platform).sort()).toEqual(["instagram", "tiktok", "youtube"]);
    expect(PLATFORM_QUESTION.type).toBe("choice");
    if (PLATFORM_QUESTION.type !== "choice") return;
    expect(PLATFORM_QUESTION.options).toEqual(PLATFORM_CHOICES.map((choice) => choice.option));
    expect(PLATFORM_QUESTION.other).toBe(false);
    // The same render goes out on several networks, so the customer may pick more than one.
    expect(PLATFORM_QUESTION.multiple).toBe(true);
  });

  it("is asked by every template, spelled once", () => {
    for (const template of all) {
      expect(template.questions.find((q) => q.key === PLATFORM_ANSWER_KEY), template.name).toBe(PLATFORM_QUESTION);
    }
    expect(declaration.questions.map((q) => q.key)).toContain(PLATFORM_ANSWER_KEY);
  });

  /** Picking a network is not connecting an account; the help text is where a customer learns that. */
  it("says, in a customer's words, that they still have to connect the account", () => {
    expect(PLATFORM_QUESTION.help ?? "").toMatch(/connect/i);
  });

  /** This test asks the real engine, so nobody has to re-derive the cap. */
  it("fits what the engine will actually install, and a fifth is refused by name", async () => {
    for (const template of all) {
      expect(template.questions.filter((q) => q.optional !== true), template.name).toHaveLength(3);
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

  /** Third, so the form reads as what the channel is, where it goes, what it is like, how often. */
  it("is asked after the network and before the cadence", () => {
    expect(TEMPLATES.faceless.questions.map((q) => q.key)).toEqual(["niche", PLATFORM_ANSWER_KEY, REFERENCE_ANSWER_KEY, "cadence"]);
  });
});
