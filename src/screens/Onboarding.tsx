import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { apiGet, apiSend, messageOf } from "../api";
import { ACTIVE } from "../../templates";

/** The onboarding answers as the server holds them: one key per question the template asks. */
export type ChannelProfile = Record<string, string | null | undefined>;

/**
 * Where a browser opening this dashboard belongs.
 *
 * `/` redirected straight to `/chat`, so the screen that explains what this channel is — the only
 * place the operator is asked what they want the channel to be, and the only writer of the profile
 * every agent reads — could be reached by typing its path and no other way. A channel that has
 * answered its questions goes to the chat; one that has not is set up first.
 *
 * A read that FAILED is not an unanswered channel: it says nothing either way, so it lands on the
 * chat, where the screens report their own errors, rather than putting a working channel back
 * through setup on the strength of a network blip.
 */
export function landingPath(profile: ChannelProfile | null): string {
  if (profile === null) return "/chat";
  const answered = ACTIVE.questions.every((question) => (profile[question.key] ?? "").trim() !== "");
  return answered ? "/chat" : "/onboarding";
}

/** The index route: asks the server what this channel has answered, then sends the operator there. */
export function ChannelGate() {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    apiGet<ChannelProfile>("/onboarding").then(
      (profile) => setTo(landingPath(profile)),
      () => setTo(landingPath(null)),
    );
  }, []);
  return to === null ? <div className="pane-in absence">Opening your channel…</div> : <Navigate to={to} replace />;
}

/**
 * First-run onboarding: a short conversation about the channel. The channel manager agent
 * proposes; the person picks or types. Everything downstream (the agents' briefs, the calendar,
 * what the crew is pointed at) is seeded from this.
 *
 * The screen asks whatever the running template asks and nothing more: `faceless` wants a niche,
 * `clipping` wants a niche and the source channel it may cut from. That difference is the
 * template's data (`templates/`), not this screen's — which is why there is one screen and no
 * branch in it.
 */
export function Onboarding() {
  const { questions, words } = ACTIVE;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const answered = (key: string) => (answers[key] ?? "").trim();
  const complete = questions.every((question) => answered(question.key) !== "");

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="eyebrow mb-3">Set up your channel</div>
        <h1 className="page-title mb-6">{words.onboardingTitle}</h1>

        <div className="mb-4 flex flex-col gap-3">
          <div className="bubble bubble-agent max-w-md">{words.onboardingBlurb}</div>
        </div>

        {questions.map((question) => (
          <div key={question.key} className="mb-6">
            <div className="eyebrow mb-2">{question.label}</div>
            {question.options.length > 0 ? (
              <div className="mb-2 grid grid-cols-2 gap-2">
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`btn justify-start ${answered(question.key) === option ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setAnswers((was) => ({ ...was, [question.key]: option }))}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              className="input w-full"
              placeholder={question.placeholder}
              value={answers[question.key] ?? ""}
              onChange={(e) => setAnswers((was) => ({ ...was, [question.key]: e.target.value }))}
            />
          </div>
        ))}

        {error ? <p className="mb-3 text-sm text-tone-fail">{error}</p> : null}

        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-3">
            {complete
              ? questions.map((question) => `${question.label}: ${answered(question.key)}`).join(" · ")
              : `Answer ${questions.length === 1 ? "the question" : "both questions"} to continue`}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!complete}
            // The profile is the channel: it is saved before the operator is let through, so a
            // failure is shown here rather than swallowed into a channel that has none.
            onClick={() => {
              setError(null);
              const profile = Object.fromEntries(questions.map((q) => [q.key, answered(q.key)]));
              apiSend("PUT", "/onboarding", profile).then(
                () => navigate("/chat"),
                (err: unknown) => setError(messageOf(err)),
              );
            }}
          >
            Create channel <ArrowRight size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
