/**
 * `music` — AI Music Channel: one original song at a time, posted as a short vertical video of its
 * cover held still over the track (vetta-mono ADR-1904).
 *
 * A piece moves along the board as a chain of cards:
 *
 *   composer ──Cover──▶ cover-artist ──Publish──▶ channel-manager ──▶ approval card
 *
 * The composer's daily fire writes ONE song (`generate_music`, one call) from the channel note's
 * context seed, and starts its Cover card. The cover-artist makes ONE square cover and muxes it with
 * the song into a 1080×1920 mp4 with ffmpeg — a network takes no audio-only post, and `social.post`
 * uploads images, videos and documents only — then hands the mp4 to the channel manager, who posts it
 * on the approval card. The analyst reads the numbers like on every template.
 *
 * Day one: the channel manager writes the CHANNEL NOTE (the context seed every song starts from: the
 * pinned genre skill's, verbatim, or one built from the genre answer) on the `channel-note` card, and
 * the first song waits on it. The four genre niches (`hardstyle`, `techno`, `rap`, `pop`) are this
 * crew with `naive/channel-template-<genre>` pinned, so they ask only the cadence.
 *
 * NO AI LABEL: no seat writes an AI label or disclosure line into the caption, and no seat sets the
 * post's `ai_generated` flag. Both are the operator's opt-in (vetta-mono ADR-1636, ADR-1904).
 */
import {
  ANALYST_REPORT,
  CADENCE_QUESTION,
  CREW_RULES,
  FIRST_PIECE_KEY,
  PLATFORMS,
  REFERENCE_ANSWER_KEY,
  agent,
  analystSchedules,
  channelManager,
  channelPlanCard,
  lengthPhrase,
  schedule,
  task,
  type Length,
  type MediaTemplate,
  type SetupQuestion,
} from "./template.ts";
import type { AgentDecl } from "@usenaive-sdk/blueprints";

/** Every song is 30 seconds: `generate_music`'s `length_seconds`, and so the post's length. */
export const MUSIC_LENGTH: Length = { min: 30, max: 30 };

/** The song length the composer asks `generate_music` for. */
export const SONG_SECONDS = MUSIC_LENGTH.max;

/** The playbook every music seat pins; a genre niche appends its own after it. */
export const MUSIC_SKILL = "naive/channel-template-music";

/**
 * ffmpeg and ffprobe for the cover-artist's computer, which does not ship them (r5). One pinned,
 * checksummed static build, installed into the home directory: the home is what the machine's
 * archive carries to a replacement machine, so it is installed once, not fetched from a moving
 * "latest" on every new machine. A no-op once either copy is there. The same lines are in
 * `naive/channel-template-music` (vetta-mono `skills/`).
 */
export const FFMPEG_BUILD = "https://johnvansickle.com/ffmpeg/old-releases/ffmpeg-6.0.1-amd64-static.tar.xz";
export const FFMPEG_SHA256 = "28268bf402f1083833ea269331587f60a242848880073be8016501d864bd07a5";
export const FFMPEG_SETUP =
  `export PATH="$HOME/bin:$PATH"; command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || (curl -fsSL -o /tmp/ff.tar.xz ${FFMPEG_BUILD} && echo "${FFMPEG_SHA256}  /tmp/ff.tar.xz" | sha256sum -c - && tar -xJf /tmp/ff.tar.xz -C /tmp && mkdir -p "$HOME/bin" && cp /tmp/ffmpeg-6.0.1-amd64-static/ffmpeg /tmp/ffmpeg-6.0.1-amd64-static/ffprobe "$HOME/bin/" && rm -rf /tmp/ff.tar.xz /tmp/ffmpeg-6.0.1-amd64-static); ffmpeg -version | head -1; ffprobe -version | head -1`;

/**
 * The post, made on the cover-artist's computer: the square cover centred on a 1080×1920 frame over a
 * blurred, darkened copy of itself, the song as the AAC audio track, as long as the song. The same
 * recipe is in `naive/channel-template-music` (vetta-mono `skills/`).
 *
 * Two steps, because the machine has one vCPU and 1 GB (r5: the one-pass blur at 30 fps was killed
 * for memory twice, and the machine with it). The frame is composed once; the video is that still
 * frame, read at 2 fps and written at 30 by one x264 thread with a short lookahead: about 400 MB and
 * a few seconds, where the one-pass recipe took 1.8 GB.
 */
export const MUX_RECIPE =
  'export PATH="$HOME/bin:$PATH"; ffmpeg -y -loglevel error -i cover.png -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2,eq=brightness=-0.15[bg];[0:v]scale=1080:1080[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2" -frames:v 1 frame.png && ffmpeg -y -loglevel error -framerate 2 -loop 1 -i frame.png -i song.mp3 -map 0:v -map 1:a -c:v libx264 -preset veryfast -tune stillimage -threads 1 -x264-params rc-lookahead=8 -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart post.mp4';

/**
 * Several music channels can share one company's board (a second install's seats are prefixed, and
 * told their names in the "Your team's names here" line `scoped()` appends). Cards carry no project,
 * so a seat finds its own channel's cards by who holds them — never "the" channel-note card.
 */
export const OWN_CARDS =
  "Other channels may share this board. Your channel's cards are the ones your own crew holds (by your team's names line, else the seat names as written): board_read with owner set to that seat's name, and never take a note, seed, mood line or queue from another crew's card.";

/** What the channel manager is told on a music channel, before the crew's rules. */
export const MUSIC_PUBLISHER_BRIEF = `On this channel the Publish card's video is a song: the cover held still over the track. Add no AI label or disclosure line to the caption, and never mark the post AI-generated yourself — both are the operator's choice. On your channel-note card you write the CHANNEL NOTE (\`${MUSIC_SKILL}\`); it is the only card you write a seed on. ${OWN_CARDS}`;

/** One seat with a clause inserted before the crew's rules — what `niche()` does with a seat's `brief`. */
const withBrief = (seat: AgentDecl, text: string): AgentDecl => {
  const system = seat.system ?? "";
  if (!system.endsWith(CREW_RULES)) throw new Error(`seat "${seat.name}" has no crew rules to insert a brief before`);
  return { ...seat, system: `${system.slice(0, -CREW_RULES.length)}${text} ${CREW_RULES}` };
};

/** Where every music seat reads the channel's sound: the day-one card the channel manager closes. */
const NOTE = "the CHANNEL NOTE — the note on the channel-note card your own channel-manager holds (board_read, owner your channel-manager)";

/** A reference that is a song or a channel: heard and described, never copied. Same key as the video templates'. */
export const MUSIC_REFERENCE_QUESTION: SetupQuestion = {
  key: REFERENCE_ANSWER_KEY,
  label: "Reference",
  type: "text",
  optional: true,
  placeholder: "A song or channel link",
  help: "A song or channel whose sound to aim for — described in musical words, never copied.",
};

const composer = agent({
  name: "composer",
  role: "Songs",
  description: "Writes each original song from the channel note's sound, one generate_music call a song, and starts its cover.",
  brief: `You are the composer, the head of the chain: you write the channel's songs, one at a time. Read ${NOTE} and the board first. With no CHANNEL NOTE yet, start nothing. A Cover card your cover-artist holds or a Publish card your channel-manager holds, not yet closed, means the queue is ahead: make nothing. Read the newest weekly report card your channel-manager holds for which subjects to make more and less of. Each song runs ${lengthPhrase(MUSIC_LENGTH)}. Its prompt is the CONTEXT SEED block of the CHANNEL NOTE, word for word, then ONE sentence on what this song is about — under 2000 characters in all. First, on every wake, read your card's comments: after a SONG comment or two MUSIC FAILED comments, never call generate_music for that card again — go on from the SONG, or close the card STOPPED. Call generate_music ONCE with that prompt, length_seconds ${SONG_SECONDS}, and instrumental true only where the seed says no vocals; comment "SONG <fil_ id>" on your card the moment it lands. Each failed call: comment "MUSIC FAILED <the error>" at once; "not configured" is never retried (close the card STOPPED), and any other failure is retried once; a second failure means STOPPED. Where project_context holds a reference answer, open it once (browser or web_fetch) and put its sound in musical words — tempo, drums, bass, lead, mood — into your sentence; never name or imitate a real artist, song or label. Then start the cover by creating a card for the cover-artist — title "Cover: <the song>", assignee cover-artist, with no blocked_by — whose body holds the song's fil_ id, the one-sentence subject, and a draft caption: one or two lines on the mood in plain words, optional hashtags, no artist name, and no AI label. You never make a cover, a video or a post. ${OWN_CARDS} Close your card with the song's fil_ id and the Cover card's id. \`${MUSIC_SKILL}\` is the playbook.`,
  tools: ["generate_music"],
  skills: [MUSIC_SKILL],
  schedules: [
    schedule({
      cron: "0 10 * * *", // Daily 10:00 — the cadence gate below decides whether today makes a song.
      summary: "Write the next song",
      input: `Write the next song. Read project_context, ${NOTE}, the newest weekly report card, and your own crew's Cover and Publish cards (board_read, owner your cover-artist, then your channel-manager). With no CHANNEL NOTE yet, or a Cover or Publish card of your crew not yet closed, or your first-song card not yet closed, or the next free posting slot for the cadence answer more than a day away, make nothing and say why in one line. Otherwise start ONE song as your brief says: one generate_music call, then its Cover card for the cover-artist.`,
      budget_micro_usd: 2_000_000, // $2 — one 30-second song (~$0.08) and the turns around it.
    }),
  ],
});

const coverArtist = agent({
  name: "cover-artist",
  role: "Covers",
  description: "Makes one square cover for each song and turns the two into the short vertical video the channel posts.",
  brief: `You are the cover-artist. A Cover card wakes you with a song's fil_ id, its one-sentence subject and a draft caption. Read the COVER DIRECTION line of ${NOTE}. Make ONE square cover: generate_image with aspect_ratio 1:1, the COVER DIRECTION and the song's sentence, and no text, letters, logo, watermark or real person's face; comment "COVER <fil_ id>". Inspect it with view_image: text, a logo or a face gets ONE corrected retry, and a second miss means STOPPED. Then make the post, a vertical video of the cover held still over the song (\`${MUSIC_SKILL}\`): fetch_file the cover and the song (cover.png below is the cover as fetched, with its own extension; song.mp3 the song), then with bash run exactly, first: ${FFMPEG_SETUP} — and then: ${MUX_RECIPE} Never install ffmpeg any other way. VERIFY with ffprobe: one video stream at 1080x1920, one audio stream, and a duration within 1 second of the song's. A failed probe is fixed and run once more; a second failure means STOPPED. publish_file post.mp4 and comment "VIDEO <fil_ id>". Then create the next card — title "Publish: <the song>", assignee channel-manager, blocked_by your Cover card — whose body holds the video's fil_ id (the file to post), the cover's and the song's fil_ ids, and the caption as drafted. You never write or change the song, and you never post. ${OWN_CARDS}`,
  tools: ["generate_image", "view_image", "fetch_file", "publish_file", "bash"],
  skills: [MUSIC_SKILL],
  schedules: [],
});

const analyst = agent({
  name: "analyst",
  role: "Performance",
  description: "Records every post's numbers daily and reports weekly, per song and subject, on what to make more and less of.",
  brief: `You are the analyst: you measure, and you never compose, make covers or publish. Every morning you record the numbers (social.post_metrics). Once a week you write the report: per song — each closed Publish card your channel-manager holds names its post ids — what went out and what it did, in numbers you actually read. Read the Cover cards behind them and ${NOTE}: the one-sentence subject and the seed are what the numbers are a verdict on, so report by subject and by mood, and say which seeds' subjects did better. ${OWN_CARDS} ${ANALYST_REPORT}`,
  tools: ["social.post_metrics"],
  skills: ["naive/channel-report"],
  schedules: analystSchedules("Per song, say what went out and what it did, and which seeds' subjects did better."),
});

export const MUSIC: MediaTemplate = {
  name: "music",
  title: "AI Music Channel",
  length: MUSIC_LENGTH,
  description:
    "Writes one original song at a time from the channel's genre seed, makes a square cover for it, and turns the two into a short vertical video that waits for your approval before it posts.",
  platforms: PLATFORMS,
  pipeline: ["composer", "cover-artist", "channel-manager"],

  agents: [
    {
      ...withBrief(channelManager(), MUSIC_PUBLISHER_BRIEF),
      skills: ["naive/caption-writing", MUSIC_SKILL],
    },
    composer,
    coverArtist,
    analyst,
  ],

  tasks: [
    task({
      key: "channel-note",
      title: "Write the channel note: the sound every song starts from",
      assignee: "channel-manager",
      body: `Day one is set-up: write the CHANNEL NOTE, the sound every song on this channel starts from, as this card's note: the whole note goes in the body of the board_write update that closes this card (status done), never in a comment, because the cards waiting on this one read the note. No model is called on this card. Read no other channel's cards: another crew's note on this board is not this channel's sound. Read project_context and, with read_skill, every skill pinned to you (\`${MUSIC_SKILL}\`, and the channel's genre skill where one is pinned). The note's first line is CHANNEL NOTE. Then a fenced block headed CONTEXT SEED: where a genre skill is pinned, its Context seed copied word for word; otherwise build it from the genre answer in the same shape — tempo in BPM, drums, bass, lead, vocals or "No vocals.", what the songs are about, and what they must never be, ending "Original composition, not based on any existing song or artist." Then one line, COVER DIRECTION: the cover's subject, palette and light, and never text, a logo or a real face. Every later song, cover and caption reads this note, and it does not change mid-channel. Where the genre answer is missing, write your own reading from the setup, say in the note that it is your reading, end the note with the line OPERATOR QUESTION: <the one question you will ask> (the channel-manager asks this itself; do not ask it again), close the card, and only THEN ask the operator once with ask_operator, commenting their answer on this card.`,
    }),
    channelPlanCard("the channel's mood and who it is for, in one line."),
    task({
      key: "cover-look",
      title: "Set the cover brief and check the machine the posts are made on",
      assignee: "cover-artist",
      blocked_by: ["channel-note"],
      body: `Day one is set-up, not a cover. Read project_context and the CHANNEL NOTE — the note on the channel-note card this one waited on. Write, as this card's note, the cover brief you will hold every song to, in two lines: the COVER DIRECTION in your own words, and what no cover may show (text, letters, a logo, a real face). Then set up and check the machine every post is made on: with bash run exactly ${FFMPEG_SETUP} and put the two version lines it prints in your note; where either is missing, say so in the note's first line. Call no model and make no file on this card.`,
    }),
    task({
      key: "report-frame",
      title: "Set up the weekly report this channel will be measured against",
      assignee: "analyst",
      blocked_by: ["channel-plan"],
      body: "Read project_context and the channel plan — the note on the channel-plan card this one waited on. Write, as this card's note, the skeleton of the weekly report: the metrics you will read per piece and where they come from (social.post_metrics), and the week's target taken from the plan's posting slots rather than invented here. Write no report today — nothing has posted, and your Monday 07:30 fire writes the first real one. Call no social tool on this card and request none with request_tools: social.post_metrics is offered once an account is connected, and nothing needs it before then.",
    }),
    task({
      key: FIRST_PIECE_KEY.music,
      title: "Start the channel's first song",
      assignee: "composer",
      blocked_by: ["channel-note"],
      body: `Start the channel's first song today. Read project_context and the CHANNEL NOTE — the note on the channel-note card this one waited on. Read this card's comments first: a SONG comment or two MUSIC FAILED comments mean no more generate_music on this card, as your brief says. Make ONE song as your brief says: the CONTEXT SEED word for word plus one sentence, one generate_music call, then the Cover card for the cover-artist with the song's fil_ id, the sentence and a draft caption. ONE song today: its chain of cards takes it to the approval card, and your daily timer starts the rest. Put the Cover card's id in your note.`,
    }),
  ],

  /**
   * The genre (keyed `niche`, so a genre niche drops it like every niche does — ADR-1143), a sound
   * to aim for (optional), and how often.
   */
  questions: [
    {
      key: "niche",
      label: "Genre",
      type: "choice",
      options: ["Hardstyle", "Techno", "Rap", "Pop", "Lo-fi hip hop", "Synthwave"],
      help: "Pick one or type your own. The channel manager turns it into the channel's sound on day one.",
    },
    MUSIC_REFERENCE_QUESTION,
    CADENCE_QUESTION,
  ],
};
