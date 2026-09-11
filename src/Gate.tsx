/**
 * THE GATE: the one screen a signed-out browser sees, and the reason no card ever again says
 * "missing or invalid dashboard token".
 *
 * Every `/api/*` route on the deployment is behind the operator's session cookie (`server/routes.ts`,
 * `dashboardAuth`), and until now the app found that out one card at a time: each screen fetched,
 * each fetch 401'd, and each header slot printed the server's refusal, with nothing anywhere a person
 * could click or type to fix it. The dashboard was a wall of the same sentence.
 *
 * Now nothing gated is fetched until `GET /api/session` has answered. Signed in, the app renders as
 * before. Signed out, ONE full-screen gate renders instead of it, offering the two doors the server
 * says exist: the studio's `/open` for this app (which hands the browser back signed in through the
 * ticket path) and, when the platform has set one, the operator's dashboard password.
 *
 * The studio door is tried on its own, once. A browser that lands here without a session is most
 * often one that simply typed the URL, and the studio is where its login already is — so the first
 * visit bounces there automatically. `sessionStorage` remembers the attempt for this tab, so a
 * studio that refused (signed out there too, or a different org) does not loop the browser between
 * the two origins; the second arrival draws the gate and lets the person choose.
 *
 * Inside the studio's own `<iframe>` there is no bounce at all: a framed navigation to the studio
 * would be refused by its frame policy or nest it inside itself. The framed gate draws the form
 * straight away, and its studio link opens in the top window (`target="_top"`).
 *
 * The mark is best-effort. A cross-site frame with third-party storage blocked (Chrome Incognito,
 * Brave) throws `SecurityError` on merely touching `sessionStorage`, while the partitioned cookie
 * keeps working. A store that cannot be read counts as "already attempted": the gate draws its
 * doors rather than bouncing forever or crashing the frame blank.
 *
 * The password form is a plain HTML post, deliberately: the value goes straight to `/api/enter` as a
 * document navigation and never through this bundle's state, a URL or storage. A refusal comes back
 * as `/?entry=denied`, which is the only thing the gate reads out of the address.
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiGet, messageOf } from "./api";

/** `GET /api/session`, as the server answers it. */
export interface Session {
  authenticated: boolean;
  /** `<NAIVE_STUDIO_URL>/apps/<NAIVE_APP_ID>/open`, or null when the platform set neither. */
  studio_url: string | null;
  password_enabled: boolean;
}

/** The tab-scoped mark that the automatic studio bounce has been spent. */
export const ATTEMPTED = "naive.entry.attempted";

export const TITLE = "Sign in to your dashboard";
export const DENIED_TEXT = "That didn't check out — try again or use your dashboard password.";
export const CLOSED_TEXT = "This dashboard is opened from the studio that installed it.";

/** Whether the address carries the server's refusal (`/?entry=denied`). */
export const wasDenied = (search: string): boolean => new URLSearchParams(search).get("entry") === "denied";

/**
 * What the gate does with the session it read: render the app, bounce to the studio, or draw
 * itself. Pure, so the exactly-once rule can be asserted without a browser.
 *
 * The bounce happens only when there is somewhere to bounce to, only at the top level, only when
 * this tab has not tried it already, and never on the way back from a refused password — a person
 * who just typed one wrong is owed the form again, not a trip to another site.
 */
export function decide(session: Session, attempted: boolean, denied: boolean, framed = false): "app" | "bounce" | "gate" {
  if (session.authenticated) return "app";
  if (session.studio_url !== null && !attempted && !denied && !framed) return "bounce";
  return "gate";
}

const readAttempted = (): boolean => {
  try {
    return window.sessionStorage.getItem(ATTEMPTED) !== null;
  } catch {
    return true;
  }
};
const markAttempted = (): void => {
  try {
    window.sessionStorage.setItem(ATTEMPTED, "1");
  } catch {
    // Unreachable store: readAttempted() already answers true, so the bounce is not retried.
  }
};
const clearAttempted = (): void => {
  try {
    window.sessionStorage.removeItem(ATTEMPTED);
  } catch {
    // Nothing was written to an unreachable store.
  }
};
const leave = (url: string): void => window.location.assign(url);
/** Whether this document is someone else's frame — the studio's preview — rather than the tab itself. */
const inFrame = (): boolean => window.self !== window.top;

interface GateProps {
  children: ReactNode;
  /** The top-level navigation the bounce performs; a test hands in a spy. */
  go?: (url: string) => void;
  /** Whether the document is framed; defaults to asking the window. */
  framed?: boolean;
}

export function Gate({ children, go = leave, framed = inFrame() }: GateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const denied = wasDenied(window.location.search);

  useEffect(() => {
    let live = true;
    apiGet<Session>("/session").then(
      (answer) => { if (live) setSession(answer); },
      (reason: unknown) => { if (live) setError(messageOf(reason)); },
    );
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (session === null) return;
    const verdict = decide(session, readAttempted(), denied, framed);
    if (verdict === "app") clearAttempted();
    if (verdict === "bounce" && session.studio_url !== null) {
      // The mark is set before the navigation, so a studio that answers instantly still finds it.
      markAttempted();
      setLeft(true);
      go(session.studio_url);
    }
  }, [session, denied, go, framed]);

  if (session === null) {
    // Nothing is drawn while the answer is out. A server that could not answer is a gate with no doors.
    return error === null ? null : <Screen title={TITLE} subtitle={error} tone="fail" />;
  }
  if (session.authenticated) return <>{children}</>;
  if (left || decide(session, readAttempted(), denied, framed) === "bounce") return <Screen title="Opening your dashboard…" />;

  const studio = session.studio_url;
  return (
    <Screen title={TITLE} subtitle={denied ? DENIED_TEXT : undefined} tone={denied ? "fail" : "quiet"}>
      {studio !== null ? (
        framed ? (
          <a className="btn btn-primary w-full" href={studio} target="_top">
            Open in the Studio
          </a>
        ) : (
          <a className="btn btn-primary w-full" href={studio}>
            Open with Naive Studio
          </a>
        )
      ) : null}
      {session.password_enabled ? (
        <form method="post" action="/api/enter" className={studio !== null ? "mt-5 space-y-3" : "space-y-3"}>
          <label className="field-label" htmlFor="dashboard-password">
            {studio !== null ? "Or sign in with your dashboard password" : "Dashboard password"}
          </label>
          <input id="dashboard-password" className="input" type="password" name="password" autoComplete="current-password" required />
          <button type="submit" className="btn btn-quiet w-full">
            Sign in
          </button>
          <p className="field-hint">The password is shown in the studio, on this app's Access panel.</p>
        </form>
      ) : null}
      {studio === null && !session.password_enabled ? <p className="text-sm text-ink-2">{CLOSED_TEXT}</p> : null}
    </Screen>
  );
}

function Screen({ title, subtitle, tone = "quiet", children }: { title: string; subtitle?: string; tone?: "quiet" | "fail"; children?: ReactNode }) {
  return (
    <main className="grid h-dvh place-items-center bg-ground px-6">
      <section className="panel w-full max-w-sm p-6" aria-labelledby="gate-title">
        <h1 id="gate-title" className="page-title">{title}</h1>
        {subtitle ? <p className={`mt-2 text-sm ${tone === "fail" ? "text-fail" : "text-ink-2"}`}>{subtitle}</p> : null}
        {children ? <div className="mt-5">{children}</div> : null}
      </section>
    </main>
  );
}
