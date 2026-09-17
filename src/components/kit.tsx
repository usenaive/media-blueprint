import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const frame = "w-full rounded-md border border-line bg-sunken";
  if (FILE_ID.test(src)) return <VideoPoster className={frame} src={`/api/files/${src}`} label={label} />;
  if (VIDEO.test(src)) return <VideoPoster className={frame} src={src} label={label} />;
  if (IMAGE.test(src)) return <img className={`${frame} object-cover`} src={src} alt={label} />;
  return (
    <a className="block truncate font-mono text-xs text-ink-2 underline" href={src} target="_blank" rel="noreferrer">
      {src}
    </a>
  );
}

/**
 * A VIDEO IS FETCHED WHEN IT IS PLAYED, NOT WHEN IT IS SHOWN.
 *
 * `/api/files/:id` pipes the whole object with no range support, so a `<video>` on the page — even
 * at `preload="metadata"` — pulls the entire render before it draws a frame, and a queue of twenty
 * posts pulls twenty renders at once. Until the operator presses play there is no `<video>` at all:
 * a portrait poster frame, and one press mounts the player and starts it.
 */
export function VideoPoster({ src, label, className = "" }: { src: string; label: string; className?: string }) {
  const [playing, setPlaying] = useState(false);
  if (playing) return <video className={className} src={src} controls autoPlay playsInline preload="auto" />;
  return (
    <button
      type="button"
      data-video-poster={src}
      aria-label={`Play ${label}`}
      onClick={() => setPlaying(true)}
      className={`group grid aspect-[9/16] place-items-center ${className} hover:bg-hover`}
    >
      <span className="grid size-10 place-items-center rounded-full bg-ink/80 text-surface group-hover:bg-ink">
        <svg viewBox="0 0 24 24" className="size-4 translate-x-px" fill="currentColor" aria-hidden>
          <path d="M7 4.5v15l12-7.5z" />
        </svg>
      </span>
    </button>
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
    <span className="chip chip-plain">
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

/** A card: a white panel whose head carries the title, its chips and any control on the right. */
export function Card({
  title,
  meta,
  aside,
  className = "",
  children,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {title !== undefined || aside !== undefined ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            {title !== undefined ? <h2 className="card-title truncate">{title}</h2> : null}
            {meta !== undefined ? <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">{meta}</div> : null}
          </div>
          {aside !== undefined ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
        </header>
      ) : null}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** A section's head: an eyebrow, the count beside it, and a control on the right. */
export function SectionHead({ label, count, aside }: { label: string; count?: number; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-4">
      <h2 className="eyebrow">
        {label}
        {count !== undefined ? <span className="rail-count">{count}</span> : null}
      </h2>
      {aside}
    </div>
  );
}

/** Label-over-value facts in a grid — the alternative to a sentence that lists them. */
export function Facts({ items, cols = 3 }: { items: readonly [label: string, value: ReactNode][]; cols?: 2 | 3 | 4 }) {
  const grid = cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-4" : "grid-cols-3";
  return (
    <dl className={`grid ${grid} gap-x-4 gap-y-3`}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="prop-label">{label}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Prose that shows its first lines and opens on request, so a long brief is never a wall. Whether
 * it offers to open is measured off the clamped box (a narrow column clips sooner than a wide
 * one); the length guess stands in only where no layout has happened.
 */
export function Clamp({ text, lines = 2, className = "" }: { text: string; lines?: 1 | 2 | 3 | 4 | 6; className?: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState<boolean | null>(null);
  const box = useRef<HTMLParagraphElement>(null);
  const clamp =
    lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : lines === 3 ? "line-clamp-3" : lines === 4 ? "line-clamp-4" : "line-clamp-6";
  useLayoutEffect(() => {
    const p = box.current;
    if (p === null || open) return;
    const measure = () => { if (p.clientHeight > 0) setClipped(p.scrollHeight > p.clientHeight); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(p);
    return () => watch.disconnect();
  }, [text, lines, open]);
  const long = clipped ?? (text.length > lines * 110 || text.split("\n").length > lines);
  return (
    <div className={className}>
      <p ref={box} className={`whitespace-pre-line text-sm leading-relaxed text-ink-2 ${open ? "" : clamp}`}>{text}</p>
      {long ? (
        <button type="button" className="mt-1 text-xs font-medium text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

/** An agent's face: its initials on the tinted disc, the same everywhere it is named. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-xs";
  return (
    <span className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent`} aria-hidden>
      {name.slice(0, 2)}
    </span>
  );
}

/** "3m ago", "2h ago", "4d ago" — for a list where the date is context, not the point. */
export function ago(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

/** "2:10" — a running timer, for something the operator is waiting on right now. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** Money is integer micro-USD everywhere on the wire; this is the only place it becomes a price. */
export function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}
