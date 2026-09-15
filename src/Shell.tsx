import { BarChart3, Home as HomeIcon, Link2, ListVideo, MessageSquare, Plus, Settings2, ShieldQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { apiGet } from "./api";
import { piecesOf, type ChannelAgent, type Post } from "./data";
import { ACTIVE } from "../templates";
import { toRoster } from "./screens/Agents";
import { parked, type WireSession } from "./screens/Approvals";
import type { HomeContext } from "./screens/Home";

const NAV = [
  { to: "/", label: "Home", Icon: HomeIcon },
  { to: "/chat", label: "Chat", Icon: MessageSquare },
  { to: "/posts", label: "Posts", Icon: ListVideo },
  // An agent that has parked on an approval is blocked until a person answers, so the count that
  // matters most is the one that used to be nowhere at all.
  { to: "/approvals", label: "Approvals", Icon: ShieldQuestion },
  { to: "/analytics", label: "Analytics", Icon: BarChart3 },
  { to: "/accounts", label: "Accounts", Icon: Link2 },
];

/** The rail: an identity head (the channel's tile, name and template), flat nav rows with the
 * selected one on a grey pill, the agents as a roster with faces — the list is the nav — and a
 * foot holding the settings row and the one tinted control, `New brief`.
 *
 * Everything it names is read from the server. The rail is chrome, not a screen, so a failed read
 * simply leaves a count or a roster out rather than shouting; the screen behind it reports why. */
export function Shell() {
  const [pending, setPending] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [agents, setAgents] = useState<ChannelAgent[]>([]);
  const [niche, setNiche] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Post[]>("/posts").then((posts) => setPending(piecesOf(posts).filter((p) => p.status === "pending").length), () => {});
    apiGet<{ data?: Parameters<typeof toRoster>[0] }>("/agents").then((page) => setAgents(toRoster(page.data ?? [])), () => {});
    // The channel is named after its niche — the studio's answer, held by the platform, not a local row.
    apiGet<HomeContext>("/context").then((home) => {
      const niche = home.context.answers.find((answer) => answer.key === "niche")?.value;
      setNiche(typeof niche === "string" ? niche : null);
    }, () => {});
    apiGet<{ data?: WireSession[] }>("/sessions").then((page) => setWaiting(parked(page.data ?? [], new Map()).length), () => {});
  }, []);

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

          {agents.length > 0 ? (
            <section>
              <h2 className="rail-label">
                Agents<span className="rail-count">{agents.length}</span>
              </h2>
              <div className="rail-frame">
                {agents.map((a) => (
                  <NavLink key={a.id} to="/agents" className="rail-row equip">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                      {a.name.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{a.name}</span>
                      <span className="block truncate text-[0.6875rem] font-normal text-ink-3">{a.tools.length} tools</span>
                    </span>
                  </NavLink>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div className="shrink-0 space-y-2 border-t border-line px-3 py-3">
          <NavLink to="/agents" className="rail-row equip">
            <span className="grid size-5 shrink-0 place-items-center">
              <Settings2 size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 truncate">Channel settings</span>
          </NavLink>
          <NavLink to="/chat" className="rail-new equip">
            <Plus size={14} strokeWidth={2} />
            <span>New brief</span>
          </NavLink>
        </div>
      </nav>
      <main className="pane min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
