import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { connectNotice, channelPlatformsOf, type ContextAnswers } from "../connect";
import { apiGet, fetchAccounts, messageOf } from "../api";
import type { Account, PostStatus } from "../data";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}

const VIDEO = /\.(mp4|m4v|mov|webm|ogv)(\?|#|$)/i;
const IMAGE = /\.(jpe?g|png|gif|webp|avif|svg)(\?|#|$)/i;

/**
 * The filed media itself, playable where it stands.
 *
 * Every screen that asks the operator to approve something now shows the thing being approved. A
 * URL whose extension names a video becomes a player and one that names an image becomes the
 * image; anything else is offered as a link rather than fed to a `<video>` that would render as a
 * broken control — the honest answer to "we cannot tell what this is" is to say so and let the
 * operator open it.
 */
/** A platform file id (`generate_video` files one) is watched through the dashboard's own `/api/files/:id`. */
const FILE_ID = /^fil_\w+$/;

export function MediaPreview({ src, label }: { src: string; label: string }) {
  const frame = "w-full rounded-md border border-line bg-surface-sunken";
  if (FILE_ID.test(src)) return <video className={frame} src={`/api/files/${src}`} controls preload="metadata" playsInline />;
  if (VIDEO.test(src)) return <video className={frame} src={src} controls preload="metadata" playsInline />;
  if (IMAGE.test(src)) return <img className={`${frame} object-cover`} src={src} alt={label} />;
  return (
    <a className="block truncate font-mono text-xs text-ink-2 underline" href={src} target="_blank" rel="noreferrer">
      {src}
    </a>
  );
}

/**
 * A post's own media in the queue — the video, not a picture of the idea of a video.
 *
 * This used to draw a rectangle tinted from a random hue stored on the row, with the duration
 * printed in the corner. It read exactly like a poster frame and was nothing of the sort: the
 * operator approving a post had never seen a single frame of what they were approving, and the
 * media URL the agent filed was sitting on the row unused. When a row genuinely has no media, the
 * space says so instead of drawing a frame that is not one.
 */
export function Thumb({ src, duration }: { src?: string; duration?: string }) {
  if (src !== undefined && src !== "") {
    return (
      <div className="w-32 shrink-0">
        <MediaPreview src={src} label="The video filed with this post" />
        {duration ? <div className="mt-1 text-center font-mono text-[10px] text-ink-3">{duration}</div> : null}
      </div>
    );
  }
  return (
    <div className="grid aspect-[9/16] w-12 shrink-0 place-items-center rounded-md border border-dashed border-line px-1 text-center text-[9px] leading-tight text-ink-3">
      No video
    </div>
  );
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  pending: "Pending review",
  ready: "Ready",
  approved: "Approved — pending post",
  posted: "Posted",
  rejected: "Rejected",
};

export function StatusChip({ status }: { status: PostStatus }) {
  const cls =
    status === "posted" ? "chip-credit" : status === "rejected" ? "chip-fail" : status === "pending" ? "chip-absent" : "chip-plain";
  return <span className={`chip ${cls}`}>{STATUS_LABEL[status]}</span>;
}

export function PlatformChip({ platform, account }: { platform: string; account?: string }) {
  return (
    <span className="chip chip-plain font-mono">
      {platform}
      {account ? <span className="text-ink-3"> · {account}</span> : null}
    </span>
  );
}

/**
 * *** THE LINE THAT SAYS WHETHER THIS CHANNEL CAN PUBLISH AT ALL. ***
 *
 * One sentence, at the top of the two screens an operator opens first: which networks this channel
 * posts to (their own setup answer, one or several), whether an account is connected for each, and
 * where to connect one. Before it, the answer to "have I finished setting this up?" was not on any
 * screen — the queue filled with rows for a network nobody had connected and the first refusal
 * arrived at the publish button.
 *
 * It reads both facts itself rather than taking them as props, because it belongs on screens that
 * share no state; both reads are cheap and both already existed. A read that has not answered, or
 * that failed, says so — it never reports "not connected" on the strength of a read that did not
 * happen (`connectNotice`).
 *
 * There is no new OAuth here and there must not be: connecting is the platform's own hosted portal,
 * reached from Accounts, which is where the button already is.
 */
export function ConnectLine() {
  const [context, setContext] = useState<ContextAnswers | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // The channel's networks are the setup answer; before it answers, the running template's own
    // fallback is used, which is the same resolution the server makes.
    apiGet<{ context?: ContextAnswers }>("/context").then(
      (home) => { if (live && home.context) setContext(home.context); },
      () => {},
    );
    fetchAccounts().then(
      (rows) => { if (live) setAccounts(rows); },
      (err: unknown) => { if (live) setError(messageOf(err)); },
    );
    return () => { live = false; };
  }, []);

  const notice = connectNotice({ platforms: channelPlatformsOf(context), accounts, error });
  return (
    <div className={`connect-line mb-4 ${notice.tone === "warn" ? "connect-line-warn" : ""}`}>
      <span className={`dot ${notice.tone === "ok" ? "dot-ok" : notice.tone === "warn" ? "dot-warn" : "dot-idle"}`} aria-hidden />
      <span className="flex-1">{notice.text}</span>
      <NavLink to="/accounts" className="btn btn-ghost btn-sm shrink-0">
        {notice.tone === "ok" ? "Accounts" : "Connect an account"}
      </NavLink>
    </div>
  );
}

export function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** Money is integer micro-USD everywhere on the wire; this is the only place it becomes a price. */
export function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}
