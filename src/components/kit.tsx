import type { ReactNode } from "react";
import type { PostStatus } from "../data";

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
export function MediaPreview({ src, label }: { src: string; label: string }) {
  const frame = "w-full rounded-md border border-line bg-surface-sunken";
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

export function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** Money is integer micro-USD everywhere on the wire; this is the only place it becomes a price. */
export function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}
