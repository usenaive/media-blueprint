import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { apiSend, fetchAccounts, messageOf } from "../api";
import { PageHeader } from "../components/kit";
import type { Account } from "../data";

/**
 * The social accounts this channel posts to and reads from, grouped by network. The list is
 * whatever the org has actually connected — nothing is drawn for a network nobody connected, and
 * connecting opens the platform's own hosted portal, which is where the choice of network belongs.
 */
export function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetchAccounts().then(setAccounts, (err: unknown) => setError(messageOf(err)));
  useEffect(() => {
    void load();
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

  const platforms = [...new Set((accounts ?? []).map((a) => a.platform))].sort();

  return (
    <div className="pane-in">
      <PageHeader
        title="Accounts"
        subtitle="The social accounts your agents post to and read from — connect as many per network as the channel runs."
        actions={
          <div className="flex items-center gap-2">
            {error ? <span className="chip chip-fail">{error}</span> : null}
            <button type="button" className="btn btn-ghost btn-sm" onClick={connect}>
              <Plus size={14} strokeWidth={1.75} /> Connect an account
            </button>
          </div>
        }
      />

      {accounts === null ? (
        <div className="absence">{error === null ? "Loading connected accounts…" : "No accounts to show."}</div>
      ) : accounts.length === 0 ? (
        <div className="absence">
          No accounts connected yet. Connect one and your agents can publish the posts you approve.
        </div>
      ) : (
        <div className="space-y-6">
          {platforms.map((platform) => (
            <section key={platform}>
              <div className="mb-2 flex items-center justify-between">
                <span className="eyebrow">{platform}</span>
              </div>
              <div className="list">
                {accounts
                  .filter((a) => a.platform === platform)
                  .map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={`dot ${a.state === "connected" ? "dot-ok" : "dot-warn"}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{a.handle}</div>
                        <div className="mt-0.5 text-xs text-ink-3">
                          {a.state === "connected" ? "Connected" : "Connection expired — reconnect to resume posting"}
                        </div>
                      </div>
                      {a.state === "expired" ? (
                        <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={connect}>
                          <RefreshCw size={14} strokeWidth={1.75} /> Reconnect
                        </button>
                      ) : null}
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
