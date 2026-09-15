import { BarChart3, Clapperboard, Home as HomeIcon, Link2, ListVideo, Plus, Settings2, ShieldQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { apiGet } from "./api";
import { piecesOf, type Post } from "./data";
import { ACTIVE } from "../templates";
import { ago } from "./components/kit";
import { parked, type WireSession } from "./screens/Approvals";
import { SESSIONS_CHANGED, sessionState, type ChatSession } from "./screens/Chat";
import type { HomeContext } from "./screens/Home";

const NAV = [
  { to: "/", label: "Home", Icon: HomeIcon },
  { to: "/posts", label: "Posts", Icon: ListVideo },
  { to: "/projects", label: "Projects", Icon: Clapperboard },
  // An agent that has parked on an approval is blocked until a person answers, so the count that
  // matters most is the one that used to be nowhere at all.
  { to: "/approvals", label: "Approvals", Icon: ShieldQuestion },
  { to: "/analytics", label: "Analytics", Icon: BarChart3 },
  { to: "/accounts", label: "Accounts", Icon: Link2 },
];

const SESSION_ROWS = 20;

/** The rail: an identity head (the channel's tile, name and template), flat nav rows with the
 * selected one on a grey pill, the one tinted control, `New session`, over the chat sessions
 * newest first, and a foot holding the settings row.
 *
 * Everything it names is read from the server. The rail is chrome, not a screen, so a failed read
 * simply leaves a count out, or says the list is unavailable, rather than shouting; the screen
 * behind it reports why. */
export function Shell() {
  const [pending, setPending] = useState(0);
  const [waiting, setWaiting] = useState(0);
  // `null` is a failed read — not an empty list, which is a claim the rail must not make for it.
  const [sessions, setSessions] = useState<ChatSession[] | null>([]);
  const [niche, setNiche] = useState<string | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    apiGet<Post[]>("/posts").then((posts) => setPending(piecesOf(posts).filter((p) => p.status === "pending").length), () => {});
    // The channel is named after its niche — the studio's answer, held by the platform, not a local row.
    apiGet<HomeContext>("/context").then((home) => {
      const niche = home.context.answers.find((answer) => answer.key === "niche")?.value;
      setNiche(typeof niche === "string" ? niche : null);
    }, () => {});
    apiGet<{ data?: WireSession[] }>("/sessions").then((page) => setWaiting(parked(page.data ?? [], new Map()).length), () => {});
  }, []);

  // Re-read on every route change and whenever the Chat screen says so, so a session opened a
  // moment ago is on the rail as soon as the URL moves to it.
  useEffect(() => {
    const read = () =>
      apiGet<{ data?: ChatSession[] }>("/chat").then((page) => setSessions((page.data ?? []).slice(0, SESSION_ROWS)), () => setSessions(null));
    void read();
    window.addEventListener(SESSIONS_CHANGED, read);
    return () => window.removeEventListener(SESSIONS_CHANGED, read);
  }, [pathname]);

  const channel = niche ?? "Your channel";

  return (
    <div className="flex h-dvh">
      <nav className="rail flex shrink-0 flex-col border-r border-line">
        <div className="flex shrink-0 items-center gap-2.5 px-4 pb-3 pt-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-[13px] font-semibold text-on-accent">
            {channel.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.875rem] font-semibold leading-tight text-ink">{channel}</span>
            <span className="block truncate text-[0.6875rem] leading-tight text-ink-3">{ACTIVE.name} template</span>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
          <div className="space-y-0.5">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} end={to === "/"} className="rail-row equip">
                <span className="grid size-5 shrink-0 place-items-center">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {to === "/posts" && pending > 0 ? <span className="rail-count">{pending}</span> : null}
                {to === "/approvals" && waiting > 0 ? <span className="rail-count">{waiting}</span> : null}
              </NavLink>
            ))}
          </div>

          <section>
            <h2 className="rail-label">Sessions</h2>
            <NavLink to="/chat" end className="rail-new mb-1.5" aria-label="New session">
              <Plus size={14} strokeWidth={2} />
              <span>New session</span>
            </NavLink>
            <div className="rail-frame">
              {sessions === null ? (
                <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-fail">
                  <span className="dot dot-fail" aria-hidden />
                  Sessions unavailable
                </div>
              ) : null}
              {sessions?.length === 0 ? <div className="px-2.5 py-1.5 text-xs text-ink-3">No sessions yet</div> : null}
              {(sessions ?? []).map((s) => (
                <NavLink key={s.id} to={`/chat/${s.id}`} className="rail-row equip">
                  <span className="grid size-5 shrink-0 place-items-center">
                    <span className={`dot ${sessionState(s).dot}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.title}</span>
                    <span className="block truncate text-[0.6875rem] font-normal text-ink-3">{ago(s.created_at)}</span>
                  </span>
                </NavLink>
              ))}
            </div>
          </section>
        </div>

        <div className="shrink-0 border-t border-line px-3 py-3">
          <NavLink to="/agents" className="rail-row equip">
            <span className="grid size-5 shrink-0 place-items-center">
              <Settings2 size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 truncate">Channel settings</span>
          </NavLink>
        </div>
      </nav>
      <main className="pane min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
