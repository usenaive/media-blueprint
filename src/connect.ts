/**
 * *** "YOU STILL NEED TO CONNECT YOUTUBE." ***
 *
 * The state a new channel is actually in, said before the first post is filed rather than at the
 * publish button weeks later.
 *
 * The old shape of the failure, measured: a customer installs the blueprint, answers the setup
 * questions, and five agents open their first sessions within the minute. Nothing has ever asked
 * which network the channel posts to and nothing has ever asked them to connect an account, so the
 * queue fills with rows aimed at a network with no account behind it. The dashboard showed a full,
 * healthy-looking queue. The first sign anything was wrong was a 400 from the platform the first
 * time somebody pressed Post now — by which time the crew had spent real money rendering video for
 * a destination that did not exist.
 *
 * Two facts fix it and both were already on the wire: the networks (the customer's own setup
 * answer, `GET /api/context` — one or several) and the accounts (`GET /api/social/accounts`). This
 * module is the one sentence they make together, kept pure so it can be read on any screen and
 * asserted in a test.
 * The `ConnectLine` component that renders it lives in `src/components/kit.tsx`.
 *
 * It is deliberately not a blocker. See `README.md` — the crew goes on filing posts for a network
 * with no connected account, because a queue is a review surface and a refused filing throws away
 * a render that has already been paid for. What is not acceptable is filing them *silently*.
 */
import type { Account, PostPlatform } from "./data";
import { ACTIVE, labelOf, labelsOf, platformsFromAnswers } from "../templates";

/** What `GET /api/context` answers with; only the answers matter here. */
export interface ContextAnswers {
  answers: { key: string; label: string; value: string | string[] }[];
}

/**
 * The networks this channel posts to: the customer's setup answer, in their order, or the running
 * template's fallback alone until the context has been read (or when it names nothing
 * publishable). Exactly the resolution `server/channel.ts` performs, through exactly the same
 * function, so the line the operator reads and the networks the queue is filled for can never
 * disagree.
 */
export const channelPlatformsOf = (context: ContextAnswers | null): PostPlatform[] =>
  platformsFromAnswers(context, ACTIVE.platform);

export interface ConnectInput {
  /** Every network the customer picked; never empty. */
  platforms: PostPlatform[];
  /** `null` while the read is still out, or when it failed. */
  accounts: Account[] | null;
  /** The sentence the accounts read failed with, if it did. */
  error: string | null;
}

export interface Notice {
  /** `warn` is the one that matters: a channel that cannot publish what it is about to make. */
  tone: "ok" | "warn" | "unknown";
  text: string;
}

/**
 * One line about where this channel posts and whether it can — covering every network the
 * customer picked, because a connected YouTube account says nothing about the TikTok they also
 * ticked, and a line that named only the first would let the second fill a queue silently.
 *
 * "No account connected" and "we could not check" are different answers and are said differently —
 * the same rule `channel.list_accounts` follows on the server. Telling an operator to connect an
 * account they already connected, because a read timed out, teaches them to ignore the line.
 */
export function connectNotice({ platforms, accounts, error }: ConnectInput): Notice {
  const names = labelsOf(platforms);
  if (accounts === null) {
    return {
      tone: "unknown",
      text:
        error === null
          ? `This channel posts to ${names} — checking whether an account is connected…`
          : `This channel posts to ${names}. Could not check connected accounts: ${error}`,
    };
  }
  // A connected TikTok account is not a connected YouTube one, and the queue is aimed at each of
  // them. The org's other connections are the Accounts screen's business, not this line's.
  const missing: string[] = [];
  const expired: string[] = [];
  const connected: string[] = [];
  for (const platform of platforms) {
    const name = labelOf(platform);
    const mine = accounts.filter((account) => account.platform === platform);
    const live = mine.filter((account) => account.state === "connected");
    if (mine.length === 0) missing.push(name);
    else if (live.length === 0) expired.push(name);
    else connected.push(`${name} as ${live.map((account) => account.handle).join(", ")}`);
  }
  if (missing.length === 0 && expired.length === 0) {
    return { tone: "ok", text: `This channel posts to ${connected.join("; ")}.` };
  }
  if (platforms.length === 1) {
    return {
      tone: "warn",
      text:
        missing.length > 0
          ? `This channel posts to ${names}, and no ${names} account is connected yet — nothing here can publish until you connect one on Accounts.`
          : `This channel posts to ${names}, and its ${names} connection has expired — nothing here can publish until you reconnect it on Accounts.`,
    };
  }
  // Several networks: name each one that cannot publish, then the ones that can, so the operator
  // knows which button to press and is not told to reconnect an account that is fine.
  const problems = [
    ...(missing.length > 0 ? [`no ${either(missing)} account is connected yet`] : []),
    ...(expired.length > 0 ? [`the ${either(expired)} connection has expired`] : []),
  ];
  const fine = connected.length > 0 ? ` Connected: ${connected.join("; ")}.` : "";
  return {
    tone: "warn",
    text: `This channel posts to ${names}, and ${problems.join(" and ")} — nothing here can publish there until you connect ${missing.length + expired.length === 1 ? "it" : "them"} on Accounts.${fine}`,
  };
}

/** "TikTok", "TikTok or Instagram Reels" — the networks one problem names. */
const either = (names: string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
