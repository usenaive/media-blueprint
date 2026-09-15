import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { apiGet, apiSend, messageOf } from "../api";
import { ago, Avatar, PageHeader, PlatformChip } from "../components/kit";
import type { Account } from "../data";

interface WireAccount {
  id: string;
  platform: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  connected_at?: string | null;
}

/** A connected account as this screen lists it: the dashboard's shape plus its face and its date. */
export type AccountRow = Account & { avatarUrl?: string; connectedAt?: string };

/** The wire rows in the list's shape, platform then handle, so one network's accounts sit together. */
export const toAccountRows = (rows: readonly WireAccount[]): AccountRow[] =>
  rows
    .map((a) => ({
      id: a.id,
      handle: a.username ?? a.display_name ?? a.id,
      platform: a.platform,
      state: "connected" as const,
      ...(a.avatar_url ? { avatarUrl: a.avatar_url } : {}),
      ...(a.connected_at ? { connectedAt: a.connected_at } : {}),
    }))
    .sort((x, y) => x.platform.localeCompare(y.platform) || x.handle.localeCompare(y.handle));

const STATE_CHIP: Record<Account["state"], [label: string, cls: string]> = {
  connected: ["connected", "chip-credit"],
  expired: ["expired", "chip-fail"],
};

/** The account's own picture where the network gave one; its network's initials where it did not. */
function AccountFace({ row }: { row: AccountRow }) {
  if (row.avatarUrl) return <img src={row.avatarUrl} alt="" className="size-8 shrink-0 rounded-full border border-line object-cover" />;
  return <Avatar name={row.platform} size="md" />;
}

/**
 * The social accounts this channel posts to and reads from. The list is whatever the org has
 * actually connected — nothing is drawn for a network nobody connected, and connecting opens the
 * platform's own hosted portal, which is where the choice of network belongs.
 */
export function Accounts() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ data?: WireAccount[] }>("/social/accounts").then(
      (page) => setAccounts(toAccountRows(page.data ?? [])),
      (err: unknown) => setError(messageOf(err)),
    );
  }, []);

  const connect = () => {
    setError(null);
    apiSend<{ url?: string }>("POST", "/social/portal", { redirect_url: window.location.href }).then(
      (link) => {
        if (link.url) window.open(link.url, "_blank", "noopener");
      },
      (err: unknown) => setError(messageOf(err)),
    );
  };

  return (
    <div className="pane-in">
      <PageHeader
        title="Accounts"
        subtitle="The social accounts your agents post to and read from — connect as many per network as the channel runs."
        actions={
          <div className="flex items-center gap-2">
            {error ? <span className="chip chip-fail">{error}</span> : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={connect}>
              <Plus size={14} strokeWidth={1.75} /> Connect an account
            </button>
          </div>
        }
      />

      {accounts === null ? (
        <div className="absence">{error === null ? "Loading connected accounts…" : "No accounts to show."}</div>
      ) : accounts.length === 0 ? (
        <div className="absence">No accounts connected yet. Connect one and your agents can publish the posts you approve.</div>
      ) : (
        <div className="list">
          {accounts.map((a) => {
            const [label, cls] = STATE_CHIP[a.state];
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <AccountFace row={a} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{a.handle}</span>
                    <PlatformChip platform={a.platform} />
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-ink-3">{a.id}</div>
                </div>
                {a.connectedAt ? <span className="text-xs text-ink-3">connected {ago(a.connectedAt)}</span> : null}
                <span className={`chip ${cls}`}>{label}</span>
                {a.state === "expired" ? (
                  <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={connect}>
                    <RefreshCw size={14} strokeWidth={1.75} /> Reconnect
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
