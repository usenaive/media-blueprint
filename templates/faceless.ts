/**
 * `faceless` — a channel that generates original short-form video in one niche.
 *
 * Five seats. The trend-scout finds what is moving in the niche and files briefs; the scriptwriter
 * turns each into a video project — the plan: the hook, the beats as scenes, the facts and their
 * sources, the sound, the look, the model and the caption (`channel.create_project`); the producer
 * renders that plan (`generate_video`, `generate_image`, conditioned on the channel's style
 * templates) and finishes it, which files the post; the analyst reports weekly per post kind and
 * per hook pattern; the channel manager plans the week from the cadence answer, keeps the queue and
 * the comments, and — on its 08:00 sweep — is this channel's only review.
 * Nothing here is code: swap this template for `clipping` and the same screens, routes and store
 * serve the other crew.
 *
 * *** WHAT A PIECE IS, SINCE EVERY PROMPT BELOW ASSUMES IT. *** Between 15 and 30 seconds
 * (`MIN_SECONDS`/`MAX_SECONDS`, `template.ts`), told in one or more scenes, rendered as ONE
 * `generate_video` call — nothing on this platform joins video, so a plan's scenes are shots inside
 * a single generation and `channel.get_project` hands the producer the prompt they compile to
 * (`scenesPrompt`, `server/mcp.ts`) rather than asking it to compose one out of prose.
 *
 * *** EVERY PLAN IS WRITTEN AGAINST A VIDEO SOMEBODY ON THIS CREW ACTUALLY WATCHED. ***
 * That is new, and the whole reason the prompts below read as they do. This template used to have
 * seen exactly one thing, ever: whatever the day-one `reference-study` card could make out from a
 * page, and only when the operator had named a reference at all. Every piece forever was then
 * planned against that one frozen post — the scout researched TOPICS as text, the writer researched
 * CLAIMS as text, and nothing in the pipeline held a shell, so nothing could sample a frame out of
 * a video. Three changes close that, and they are structural rather than exhortation:
 *
 *   · `REFERENCE_QUESTION` is still the optional fourth setup question and `reference-study` is
 *     still the day-one study, but "none given" no longer means "work from the niche alone". It
 *     means go and find the two or three videos already doing this format well in this niche and
 *     study those (`REFERENCE_STUDY_RULE`, `template.ts`). Inventing a reference is still banned; looking
 *     for one never should have been, and the ban on looking is why most installs planned blind.
 *   · EVERY BRIEF CARRIES 1–3 EXEMPLARS — real videos doing that specific topic in that specific
 *     format, found and opened by the trend-scout — and the scriptwriter opens them before it plans
 *     anything. So a plan is written against something current, not against a post frozen on
 *     install day, and every scene names the exemplar and the moment its grammar came from.
 *   · The scriptwriter holds `bash`, and it is the only seat of this template that does. It is what
 *     turns an exemplar URL into stills; measured at $0.027 of frames against a $9.00 render.
 *
 * `hook-style` and `look` are still blocked on the study, so the channel's voice and look are
 * derived from the teardown rather than from the niche word, and every seat after reads the
 * teardown rather than re-fetching the URL. What `optional` means now is that an install which
 * answered nothing gets a teardown of the crew's own finding, marked as such — not no teardown.
 *
 * Every agent runs on crons and owes a card on the company board. A faceless channel whose crew only
 * moves when a human opens a chat window is not a channel, it is a chat window. Read the comment on
 * `schedule` (`template.ts`) before touching a cron string here: schedules are the one place in
 * `naive up` where omission deletes, and a live row is matched by its exact cron text.
 *
 * *** DAY ONE IS THE BOARD NOW, NOT FIVE INTAKES. *** `tasks` below (`canonical-spec §31.11`) seeds
 * eight cards on the standing orchestrator's board, and the API's tick wakes the assignee of each
 * one that is `todo`, assigned and unblocked. The intakes this replaced opened at once — declaration
 * order was never execution order — so every downstream seat read a queue its upstream was still
 * filling, and the file had to spend a paragraph telling each of them not to report the emptiness.
 * A blocker is that paragraph made structural: the scriptwriter is not woken until there are briefs
 * to script, and the producer is not woken until there is a plan to render. What is NOT blocked is
 * not blocked on purpose — a card whose blocker never closes is a seat that never starts at all.
 *
 * The ongoing pipeline still moves by handoff (`handoffs`; `send_to_agent` with `wait: false`): the scout files briefs at
 * `stage: brief` and names their ids to the scriptwriter, who writes a video project against each
 * (the row moves to `scripted` with the plan on it) and names the project ids to the producer, who
 * renders the plan and finishes it (`rendered`, on the project and the row). The crons are the
 * fallback — 06:00 briefs, 06:30 plans, 07:00 render — and pick up, by stage and by status,
 * whatever a handoff did not carry. A handoff and a cron can overlap, so a seat claims before it
 * spends: the writer claims the row (`scripting`, `expected_stage: brief`), the producer claims the
 * plan (`rendering`, `expected_status: planned`); each claim is one locked write, one session wins
 * it, and the other is refused before the work — not after the render. The render is also the one
 * step that cannot be replayed, so the claim is guarded at both ends: the producer's completion
 * write carries `expected_status` too, and a rendered plan — and the media on its row — is the
 * receipt for the render, which nothing — the producer, or the sweep freeing a dead session's
 * claim — may send back (`server/mcp.ts`).
 */
import {
  agent,
  CADENCE_QUESTION,
  channelManager,
  channelPlanCard,
  LENGTH_PHRASE,
  ONE_RENDER_MICRO_USD,
  PLATFORM_CHOICES,
  PLATFORM_QUESTION,
  REFERENCE_QUESTION,
  REFERENCE_RULE,
  REFERENCE_STUDY_RULE,
  schedule,
  SHORT_FORM_LENGTH,
  task,
  type MediaTemplate,
} from "./template.ts";

export const FACELESS: MediaTemplate = {
  name: "faceless",
  // 15–30 seconds, and the one place this template's window is written; `/mcp` refuses a plan outside it.
  length: SHORT_FORM_LENGTH,
  description: "Generates original short-form video in one niche, from briefs, in the channel's own look.",

  agents: [
    channelManager(
      "the trend-scout, the scriptwriter and the producer",
      // The 08:00 sweep is this channel's only review, and what it can honestly review is the
      // plan and the caption: no tool on this platform can watch a video, so a seat claiming to
      // have checked the render would be claiming something it cannot do.
      " That sweep is also this channel's only review: where there is a reference teardown, read each row's plan against it and flag any drift at the end of the caption, so the operator sees it beside the Approve button, and check the one thing that is always checkable — that every scene names the exemplar its grammar came from, because a plan that attributes nothing was invented rather than modelled. Judge the plan and the caption, never the video — no tool here can watch one. Once a week you re-read the reference against what this channel has actually published and file a fresh teardown where the format has moved.",
      { reference: true, planCheck: "the beats run hook, setup, turn, payoff, cta rather than three shots of the same idea" },
    ),
    agent({
      name: "producer",
      role: "Video production",
      description:
        "Renders each planned video project into one original vertical video — one render, every scene in it — in the model and style template the plan names. Finishing the plan files the piece for approval; never publishes.",
      /*
       * THE COMPILATION CAME OUT OF THIS PROMPT AND BECAME A FUNCTION. It used to say "the prompt
       * is the scenes in order with seconds, voiceover, on-screen text and look; seconds their sum"
       * — here, and again in the cron below, in slightly different words. That is a formatting job
       * asked of a model twice, done differently each night, and nobody could read afterwards what
       * had actually been sent. `channel.get_project` now hands back `render_prompt` and
       * `render_seconds` alongside the plan (`server/mcp.ts` `scenesPrompt`), so the seat renders
       * what it was given. It still decides nothing about the plan; it can no longer drop a shot
       * while summarising one.
       */
      brief: `You are the producer: yours is the render, not the plan. Take a planned project, one named to you by the operator or a handoff or the next planned (channel.list_projects); claim it before you spend anything: channel.update_project, status rendering and expected_status planned. Refused, another has it: take the next. Read the plan (channel.get_project). It comes back with \`render_prompt\` — its shots already compiled into the one prompt this piece renders as, because nothing here joins clips — and \`render_seconds\`, their sum, which is ${LENGTH_PHRASE}. Call generate_video once with exactly that prompt, seconds \`render_seconds\`, aspect_ratio 9:16, and the plan's model — and where the read carried \`render_reference_images\`, pass the FIRST of them as image_urls — one only, and it becomes the opening frame of the piece, so it is the shot the video starts on rather than a style applied throughout. Do not rewrite the prompt, do not summarise it, and do not drop a shot to make it shorter: the plan was checked when it was filed. Wait for the file. Finish: channel.update_project: status rendered, expected_status rendering, the video as \`media_url\`, your name as \`agent\`, and the plan's reference_pattern in what you say you did. Refused there, it moved on: never render twice. A revision arrives as a message on your session: re-read the plan with channel.get_project, apply the operator's note to the scenes with update_project, then render the \`render_prompt\` a fresh get_project returns and finish with the same write. Never open a second project. One plan per session; nothing planned, nothing rendered. You end the chain. ${REFERENCE_RULE}`,
      tools: ["generate_video", "generate_image"],
      /*
       * NO SKILLS, AND THE ONE IT USED TO CARRY WAS A CONTRADICTION IN THE SAME DECLARATION.
       *
       * This seat loaded `naive/short-video-hooks` — a skill that teaches how to write a hook and
       * lay a piece out in beats — while the brief three lines above forbids it the whole act:
       * "yours is the render, not the plan … do not rewrite the prompt, do not summarise it, and do
       * not drop a shot". A seat handed the standard for work it may not do is a seat invited to
       * second-guess the plan it was told to render exactly, and the one thing it cannot do is
       * replay a render it spoiled. The hook standard belongs to the scriptwriter, which holds it.
       */
      skills: [],
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next piece, before the manager's 08:00 queue sweep.
          input:
            "Make the next piece. Read the niche and tone (project_context) and the planned generation projects (channel.list_projects, status planned, kind generation); claim the next one — channel.update_project, status rendering, expected_status planned; refused means it is not yours, take the next; and a rendered plan is one the channel has paid for, so never render it again. Read the plan in full (channel.get_project): it comes back with `render_prompt`, its shots already compiled into the one prompt this piece renders as, and `render_seconds`, their sum. Call generate_video once with exactly that prompt, seconds `render_seconds`, aspect_ratio 9:16 and the plan's model, passing the first of any `render_reference_images` the read carried as image_urls, which becomes the opening frame — do not rewrite the prompt and do not drop a shot to shorten it. Wait for the file. Finish it with channel.update_project — status rendered, expected_status rendering, media_url, your name as agent; refused there means the plan moved on while you rendered, so say so and stop rather than render a second time. In the note, name the plan's reference_pattern where it has one, so the manager's sweep can read what this piece was meant to be. If nothing is planned, render nothing and stop. If generate_video is not among your tools, or it refuses for want of a model, render nothing: request exactly what is missing with request_tools — generate_video at allow, with the model to render with in config.models — once, then wait; if it is granted, carry on with the piece, and if it is refused, stop for tonight.",
          // $15 — and the figure it is sized against is ~$9.00, not the ~$6.63 this line used to
          // claim. `ONE_RENDER_MICRO_USD` is what the LEDGER debits for a `MAX_SECONDS` piece
          // (8,995,530 µUSD, measured through the platform); ~$6.63 was the provider's own invoice
          // for the same render, which understates every ceiling by the markup. A fire has to hold
          // the render's admission hold PLUS the turns that read the plan and file it, so at $15
          // that is $9.00 held and ~$6 left for a handful of model calls — enough, and deliberately
          // not raised to the seat's $20 per-task ceiling, because a fire sitting exactly on its
          // agent's ceiling has no margin left when the two are checked against each other.
          // `templates.test.ts` pins the headroom to the constant rather than to this number, so
          // the next price move fails the suite instead of failing this cron every night at the
          // same point — which is what $10 did once the format grew.
          budget_micro_usd: 15_000_000,
        }),
      ],
    }),
    agent({
      name: "trend-scout",
      role: "Trends & briefs",
      description:
        "Finds the formats and topics moving in the channel's niche this week and files each as a brief for the scriptwriter and producer to work from.",
      /*
       * *** THE BRIEF NOW CARRIES EXEMPLARS, AND THAT IS THE ONE THING ONLY THIS SEAT CAN DO. ***
       *
       * Until now the only video anything on this template had looked at was whatever the day-one
       * `reference-study` card opened, once, on install. Every piece forever was then planned
       * against that frozen post: the scout researched TOPICS as text, the writer researched CLAIMS
       * as text, and no seat ever saw how a piece in this format is actually shot. The scout is the
       * seat that finds things, so the per-piece exemplar is its filing — 1–3 real videos doing THIS
       * topic in THIS format, named on the brief, for the writer to open before it plans.
       *
       * The browser is what makes "found" mean "looked at": a search result is a title, and a
       * screenshot is the page. It is granted to every seat (`BROWSER_TOOL`, `template.ts`), so the
       * instruction costs no grant — only the discipline of opening each candidate before naming it.
       */
      brief:
        `You are the trend-scout, the head of the chain. You watch the niche, not the whole internet: read what is moving in it this week (web_search, web_fetch) — formats getting picked up, questions the audience asks, moments worth a short — and brief the best. The teardown tells you what KIND of thing to look for: brief topics that suit the formats the reference actually makes, and name which of them each brief is for. Every brief also carries its own exemplars, and nobody downstream can find them for you: one to three REAL VIDEOS already doing that topic in that format well — the videos themselves, never an article about them — each opened with the browser and screenshotted, so you have actually looked, and each carried on the brief as its URL with one line on what is worth copying and one on what is not. A brief with no exemplar is a brief the writer has to invent from, so file fewer and better. \`naive/video-trend-brief\` is the standard for all of it. A brief is a pending post with no media, filed with \`stage\` brief: its caption states the topic, the format, why now, the hook direction, the style template to render in and those exemplars; its \`source\` names where you saw it. File only what the cadence calls for. Do not restate a topic already queued or posted (channel.list_posts). When the last brief is filed — and only then — send_to_agent the scriptwriter once, wait false: the exact post ids, the instruction to plan them, a handoff_key naming today's date. Filed nothing, hand on nothing. You never plan or render — the scriptwriter and producer take it from your brief. ${REFERENCE_STUDY_RULE} ${REFERENCE_RULE}`,
      tools: ["web_search", "web_fetch"],
      /*
       * `naive/seo-content-brief` WAS HERE AND IT IS AN AGENCY SKILL. Its procedure ends in
       * `create_draft_post` — a tool of the agency blueprint, which this seat does not hold and
       * this dashboard does not serve — and it teaches the brief for an ARTICLE. This seat writes
       * no articles. The file itself is untouched, because the agency blueprint loads it; it simply
       * stops being handed to a video seat. `naive/video-trend-brief` is the same job for video,
       * and it is the one that names the exemplar as part of the deliverable.
       */
      skills: ["naive/video-trend-brief", "naive/short-video-hooks"],
      handoffs: ["scriptwriter"],
      schedules: [
        schedule({
          cron: "0 6 * * 1,4", // Monday and Thursday 06:00 — the week's briefs, and a mid-week refill.
          input:
            "Scout the niche. Read project_context, this channel's reference teardown if it has one (channel.list_posts, source \"reference teardown\") and the queue (channel.list_posts), research what is moving in the niche this week, and file as many new briefs as the cadence needs until the next fire — each a pending post with no media, stage brief, naming topic, format, why now, hook direction, style template, and which of the reference's formats it is for where there is a teardown. Every brief also names one to three exemplars: real videos already doing that topic in that format well, not articles about them, each one opened with the browser and screenshotted so you have actually looked at it, carried on the brief as its URL with one line on what is worth copying and one on what is not. A brief with no exemplar is a brief the scriptwriter has to invent from, so file fewer and better. Nothing already queued or posted. Then send_to_agent the scriptwriter once, wait false, with the ids you filed, handoff_key briefs-<today's date>; if you filed none, hand on nothing.",
          budget_micro_usd: 10_000_000, // $10 — a read of the niche and a handful of filings.
        }),
      ],
    }),
    agent({
      name: "scriptwriter",
      role: "Hooks & scripts",
      description:
        "Turns every brief into a full video plan — the hook, the beats, the shots, the facts and their sources, the sound, the look and the publishable caption — before the producer spends a render on it.",
      /*
       * WHAT THIS BRIEF USED TO BE, AND WHY IT IS THE SHAPE IT IS NOW. It was 178 words of which
       * about 39 described the writing, and those 39 were a list of fields: "title; the brief's
       * reasoning; style template and video model; the scenes in order …; the hashtagged caption".
       * The rest was row-claiming, handoff keys and refusals. A seat briefed that way files what
       * the list asks for, which is a shot list — and it did.
       *
       * The mechanics are unchanged and still here, because they are real: the claim is what stops
       * two sessions planning one row. What changed is that the craft is no longer a field list. It
       * is an ORDER OF WORK — and each step names the field it lands in, so there is no step whose
       * output has nowhere to go. The standard itself lives in `naive/short-video-hooks`, which now
       * teaches the same 15–30s shape this template renders (it taught 30–60s while these prompts
       * demanded under 15 — a seat told to load a skill and then forbidden to follow it).
       *
       * *** AND THE ORDER NOW OPENS WITH LOOKING, WHICH IS THE STEP THAT NEVER EXISTED. *** It ran
       * research → hooks → beats → shots, and every one of those four steps is TEXT: the seat read
       * about the topic, wrote about the topic, and laid out shots it had no picture of. Nothing
       * anywhere in this pipeline had ever seen a video. So the exemplars the scout named go first,
       * opened with the browser and sampled with the shell, before a hook is written — and the
       * order ends where it now has to end, with every scene naming the exemplar and the moment its
       * grammar came from. That last clause is what makes the rest checkable: a plan that
       * attributes nothing was invented, and the manager's sweep can see that without a render.
       */
      brief: `You are the scriptwriter; what you write is the plan, and the plan is the whole video decided before money is spent. Briefs reach you named by id in a handoff from the trend-scout, or at \`stage\` brief on your 06:30 fire. Claim each before you write it — channel.update_post, stage scripting, expected_stage brief; refused means another has it. Then work each claimed row in this order and no other: FIRST open the exemplars the brief names — browser for the page and its stills, bash to pull the video and sample frames, closely through the first three seconds, then publish_file each and open it with view_image; frames cost cents against a render, and nothing else here sees inside a piece. Then the teardown and your own hook style post; research the topic (web_search, web_fetch) until two or three claims are sourceable, dropping any that are not; write three hooks and keep one; lay the piece out in beats; and only then cut those beats into shots. \`naive/short-video-hooks\` is the standard for all of it. File one video project (channel.create_project, kind generation, post_id the row, agent you) with every field: hook verbatim, rejected_hooks and why the kept one won, retention, the scenes in order, each with its beat and prompt in the style template's look (channel.list_style_templates), facts with their sources, sound, cta, a video model, reference_pattern, and the caption (\`naive/caption-writing\`). EVERY SCENE NAMES THE EXEMPLAR AND THE MOMENT ITS GRAMMAR CAME FROM, so the plan is traceable to something real: a scene you cannot attribute is invented, and says so on itself. The scenes' seconds must sum to ${LENGTH_PHRASE}: they render as ONE video, nothing joins clips, so that sum is the piece. Filing it moves the row to \`stage\` scripted. When the last row is planned, send_to_agent the producer once, wait false: the project ids and the handoff_key you were handed or today's date; claimed nothing, hand on nothing. You neither render nor find topics. ${REFERENCE_STUDY_RULE} ${REFERENCE_RULE}`,
      /*
       * `view_image` and `browser` are here for the `reference-study` card and nothing else.
       *
       * THIS USED TO BE `clip_video`, AND THAT WAS THE WRONG TOOL. It is a CLIPPING tool: it
       * downloads a video, transcribes it, scores the moments and hands back `title`, `hook`,
       * `tiktok_caption`, a virality number — all derived from the AUDIO. Pointed at a reference
       * whose whole identity is visual, every one of those fields comes back empty of the thing
       * that matters, and the crew plans from a caption. Measured: it planned the wrong genre
       * outright (ADR-0758).
       *
       * `view_image` is the tool that actually looks (§16.2), AND IT LOOKS BY ID: its argument is
       * `file_ids`, so what it opens is what the org already holds — an upload the operator made, a
       * still they named as `fil_`, the id a screenshot from this same session was filed under. A
       * URL never reaches it; it is refused as `validation_failed`. It is day-one only — the
       * ongoing crons never call it and the brief above never mentions it.
       *
       * `browser` is NOT listed here because every seat already holds it (`BROWSER_TOOL`,
       * `template.ts`) — and it is the other half, the one that turns a URL into something visible:
       * its screenshot files the page and hands back the picture ALONGSIDE the `fil_` id it was
       * filed under. So the still URLs the question actually asks for are the browser's work, never
       * `view_image`'s, and the card below has to say which is which. A page still shows thumbnails
       * and titles rather than the inside of a video, so the question's help text is still the
       * honest remedy: give stills.
       */
      /*
       * *** `bash` IS THE ONE GRANT THE QUALITY FIX TURNS ON, AND IT IS HERE AND NOWHERE ELSE. ***
       *
       * Everything above is prose; this is the capability. No seat of this template held a shell, so
       * nothing in the pipeline could sample frames out of a video — the day-one card said as much
       * in its own words ("nothing here samples frames out of one"), and every plan this channel has
       * ever filed was written from page text, thumbnails and a teardown of the OUTSIDE of a piece.
       * A shell is what turns an exemplar URL into stills: ffmpeg in the session's own sandbox, cut
       * across the piece and closely through the first three seconds, which is where the format
       * lives. Measured last cycle at $0.027 for frames → vision → teardown against a $9.00 render,
       * and a controlled A/B where the blind run planned the wrong genre outright while the seeing
       * run matched its reference.
       *
       * It costs a provisioned machine per session, which is exactly why `toolset` denies the shell
       * to every other seat by name: this is the seat that PLANS, and the plan is what the money is
       * spent against. `templates.test.ts` writes the shell-holding seats out as a set, so the next
       * one is a decision somebody makes rather than a grant that spreads.
       *
       * `view_image` looks BY ID — its argument is `file_ids`, and a URL is refused outright — so it
       * opens what the org already holds: an operator's upload, a `fil_` still, the id a browser
       * screenshot from this same session was filed under. `browser` (held by every seat,
       * `BROWSER_TOOL`) is the other half: it is what turns a URL into a picture at all.
       */
      tools: ["web_search", "web_fetch", "view_image", "bash", "publish_file"],
      /*
       * `naive/reference-teardown` is the procedure the `reference-study` card used to carry in one
       * enormous paragraph — which tool opens which kind of reference, how to sample frames, what to
       * record, and marking an inference apart from an observation. It is a skill because it is now
       * read three times rather than once: the day-one study, the manager's weekly refresh, and the
       * per-piece exemplar study this seat does before every plan.
       */
      skills: ["naive/short-video-hooks", "naive/caption-writing", "naive/reference-teardown"],
      handoffs: ["producer"],
      schedules: [
        schedule({
          // Daily 06:30 — scripts on the night's briefs, before the producer's 07:00 render, and the
          // only seat that rescues a row stranded at `scripted` with no plan on it. The producer now
          // reads plans (`channel.list_projects`), not rows, so a row the old chain moved to
          // `scripted` by writing the script into its caption is read by nobody: the writer's list
          // (stage brief) skips it and the producer's (status planned) never sees it. `list_posts`
          // filters on status and stage only, so the missing plan is not a filter — it is `projectId`
          // on the rows that come back, which is why the fire is told to read stage `scripted` and
          // then drop the ones that carry one. `scripting` is left out on purpose: a row there may
          // be a live claim, and `expected_stage scripting` would not tell the two apart, so a stale
          // one is aged back to `brief` by the manager's 08:00 sweep and picked up here on the next fire.
          cron: "30 6 * * *",
          input: `Plan what the handoffs missed. Read project_context, this channel's reference teardown if it has one and your own hook style post (channel.list_posts, sources "reference teardown" and "hook style") — they are the standard every plan below is written to, and reading them is not optional just because a timer woke you. Then every row still at stage brief (channel.list_posts, stage brief); claim each — channel.update_post, stage scripting, expected_stage brief; skip any refused. Then the rows nothing else will ever take: channel.list_posts, stage scripted, keeping only those that carry no projectId — their plan was never written, so no producer can render them; claim each the same way, channel.update_post, stage scripting, expected_stage scripted, and plan it from the caption already on the row rather than inventing a new topic. For each claimed row, in this order: FIRST open the exemplars the brief names — browser for the page and its stills, bash to pull the video and sample frames across it, close through the first three seconds and sparser after, publishing each with publish_file and opening it with view_image — because a plan written without looking is the plan this channel used to file; then research the topic (web_search, web_fetch) until you have claims you can source, write three hooks and keep one, lay the piece out in beats, and only then cut the beats into shots. A rescued row carries no exemplars, so find one or two yourself the same way rather than planning blind. File it with channel.create_project (kind generation, post_id the row): title, brief, hook, rejected_hooks, retention, the scenes in order with beat, prompt, seconds, voiceover and on-screen text summing to ${LENGTH_PHRASE}, each scene naming the exemplar and the moment its grammar came from — a scene you cannot attribute says on itself that you invented it — facts with sources, sound, cta, style template, video model, reference_pattern where there is a teardown, and the publishable caption, in the channel's tone, for its audience; filing it puts the row back at stage scripted with the plan on it. Then send_to_agent the producer once, wait false, with the project ids you planned, handoff_key plans-<today's date>. Nothing claimed means nothing to do, and no trigger.`,
          budget_micro_usd: 10_000_000, // $10 — a read, the research behind each plan, and a few rewrites.
        }),
      ],
    }),
    agent({
      name: "analyst",
      role: "Performance",
      description:
        "Reports weekly on what the channel posted, by post kind and by hook, and tells the team what to make more and less of.",
      brief:
        `You are the analyst. Once a week you read what this channel posted (channel.list_posts, and the metrics of a connected account where its tools are offered) and write the report: per post kind — produced and multi-part — what went out, what it did, which hooks and formats moved and which did not, in plain numbers you actually read. Read the plans behind them too (channel.list_projects, channel.get_project): the hook, the beats and the retention line are what the numbers are a verdict on, so report by hook pattern, and say whether the pieces that followed the reference did better than the ones that drifted — that is the only evidence anyone will have about whether imitating it works. File the report as a pending post with no media so it sits in the queue where the operator and the team read; its caption is the report, its \`source\` is the period it covers. Name the two changes you would make next week. Where a metric is not offered to you, say it is unknown; a report that guesses at a number is worse than one that says it has none. ${REFERENCE_RULE}`,
      // Read-only numbers for the Monday fire; unlisted, it falls to `ask` and the cron stalls on an approval nobody sees.
      tools: ["social.post_metrics"],
      /*
       * IT HAD `skills: []` WHILE BEING THE ONE SEAT THAT WRITES A REPORT. Every other seat of this
       * template was handed the standard for its craft and the analyst was handed none, so the
       * shape of the weekly report — what to count, what to do with a metric nobody offers, how to
       * read a hook pattern against numbers — was re-invented every Monday by a seat starting from
       * a blank page. `naive/channel-report` is that standard.
       */
      skills: ["naive/channel-report"],
      schedules: [
        schedule({
          cron: "30 7 * * 1", // Monday 07:30 — last week's numbers, before the manager plans at 09:00.
          input:
            "Write the weekly report. Read project_context, what posted in the last seven days (channel.list_posts, and their numbers from social.post_metrics with since_days 7) and the plans behind those posts (channel.list_projects, channel.get_project); per post kind and per hook pattern, say what went out and what it did, and where this channel has a reference teardown, whether the pieces that followed the reference did better than the ones that drifted. Name the two changes for next week. File it as a pending post with no media.",
          budget_micro_usd: 10_000_000, // $10 — a read of the week and one report.
        }),
      ],
    }),
  ],

  /**
   * THE CREW'S FIRST DAY, AS EIGHT CARDS ON THE COMPANY BOARD (`canonical-spec §31.11`).
   *
   * Each one is SET-UP — the thing this channel owes once, that no timer below will ever do again.
   * The crons are the ongoing work and the cards deliberately do not restate them: the scout's card
   * files the first five briefs because a channel installed on a Tuesday has nothing to script until
   * Thursday 06:00 otherwise, and that is the only overlap; nobody's card writes a weekly report, a
   * queue sweep or a comment reply, because Monday 07:30, 08:00 and 18:00 already do.
   *
   * *** THE CHAIN IS THE POINT, AND EVERY LINK IN IT IS REAL. *** A card with an open `blocked_by`
   * is not due, so its seat is not woken and is not billed; when the blocker reaches `done` the tick
   * wakes it with the note the last seat wrote. Three cards depend on nothing and open the install
   * together — the plan, the briefs, the reference study — because those three seats each need only
   * `project_context` and can be got wrong by waiting. Five wait, and each waits on work it
   * genuinely cannot start without:
   *
   *   · `report-frame` waits on `channel-plan`, because the skeleton is what the channel is measured
   *     against and the plan is what sets the target — a frame written first invents its own
   *     cadence-sized week and then disagrees with the manager's.
   *   · `hook-style` and `look` now wait on `reference-study`. *** THIS IS THE NEW EDGE AND IT IS
   *     THE WHOLE VALUE OF ASKING THE QUESTION. *** Both cards used to open on day one against
   *     nothing but the niche word: the writer invented a house voice out of "True crime recaps",
   *     the producer picked a look the same way, and every plan afterwards was written to those two
   *     guesses. If the operator named a reference, the answer to both is IN it — so the study runs
   *     first and they read its teardown. When no reference was given the study card closes in one
   *     line within the minute, and these two open behind it exactly as they used to, one card's
   *     delay later.
   *   · `first-scripts` waits on `first-briefs` (there is nothing to script until briefs exist),
   *     on `hook-style` (the voice every script is written to is the writer's own earlier card) and
   *     on `look` (a plan names the style template it renders in, and the producer picks which ones
   *     this channel uses).
   *   · `first-render` waits on `first-scripts`: the producer renders a plan, and there is no plan
   *     before the writer files one. It is the one card that spends real money (~$9.00,
   *     `ONE_RENDER_MICRO_USD`) and it is last for that reason too.
   *
   * Nothing else is blocked, and that is a decision rather than an omission: a blocker that is not
   * real is a card that never becomes due and a seat that never wakes at all.
   *
   * A RE-APPLY DOES NOT DOUBLE THEM. Each `key` becomes `media:<key>` on the wire and the apply
   * answers the card that key already names.
   */
  tasks: [
    channelPlanCard("the channel's tone and who it is for, in one line — the setup form asked for the niche and not for this."),
    task({
      key: "first-briefs",
      title: "File the channel's first five briefs for its niche",
      assignee: "trend-scout",
      body: "Read project_context for the niche, the audience and the cadence. Research what is moving in that niche right now and file the channel's first five briefs as pending posts (channel.create_post, no media, stage brief, `source` naming where each came from): topic, format, why now, hook direction, style template, and one to three exemplars — real videos already doing that topic in that format well, not articles about them, each opened with the browser and screenshotted so you have actually looked at it, carried as its URL with one line on what is worth copying and one on what is not. The scriptwriter's card is blocked on this one and plans from what you name, so a brief with no exemplar is a brief it has to invent from. Skip anything already in the queue (channel.list_posts). Five good briefs beat twenty thin ones; file five and stop. Do not script them and do not hand off — the scriptwriter's card is blocked on this one and the board wakes it when you close yours, so send_to_agent here would open a second session on the same work. Put the five post ids in the note. Your Monday and Thursday 06:00 fires refill the queue from here.",
    }),
    /*
     * *** THE CARD THAT TURNS THE SETUP ANSWER INTO SOMETHING THE CREW CAN WORK FROM. ***
     *
     * An answer sitting in `project_context` that no seat is told to act on changes nothing, and
     * four seats each re-fetching a URL every fire is four bills and four different readings of the
     * same channel. So it is studied ONCE, on day one, and what was learned is filed as an ordinary
     * pending post — which is this dashboard's only shared surface between seats, and is why the
     * teardown is a post rather than a new row type: every seat already reads posts, the operator
     * can read it too, and nothing in the store or the screens had to change to carry it.
     *
     * *** THE BODY USED TO BE THE PROCEDURE, AND THE PROCEDURE IS NOW A SKILL. *** It ran to one
     * paragraph of about 640 words carrying the whole teardown: the tool-per-kind split, what to
     * record, how to mark an inference. All of that is `naive/reference-teardown` now, and it had
     * to move, because it is read THREE times rather than once — this card, the manager's weekly
     * refresh, and the per-piece exemplar study the scriptwriter does before every plan. A
     * procedure written into one card is a procedure the other two readers do not get.
     *
     * What stayed is what is day one's and is in no skill: that this is the study done ONCE, with
     * two cards blocked on it; the `fil_`-versus-URL split, because one of the two values RENDERS
     * (`generate_video` takes `image_urls`, and a `fil_` id written into `reference_frames` is a
     * plan that fails validation after it was filed and approved); and the ban on `ask_operator`,
     * which would park the session with `hook-style` and `look` waiting behind it.
     *
     * *** AND THE NO-REFERENCE BRANCH IS THE OTHER HALF OF THE QUALITY FIX. *** It used to read
     * "file nothing, close this card, the team works from the niche alone". That was the ban on
     * INVENTING a reference doing a second job it was never meant to do — banning LOOKING for one —
     * and since the question is optional it is the branch most installs took, which is how a
     * channel came to plan every piece it ever made against nothing at all. `REFERENCE_STUDY_RULE`
     * (`template.ts`) now says find real ones — once, and only on the seats that plan; this card is
     * where that first happens, so an install
     * that answered nothing still gets a teardown of real videos in its niche, marked as the crew's
     * own reading rather than the client's example.
     */
    task({
      key: "reference-study",
      title: "Study the reference this channel is modelled on, and file the teardown",
      assignee: "scriptwriter",
      body: "Read project_context, then read_skill `naive/reference-teardown` and work its procedure — which tool opens which kind of reference and why they do not substitute for one another, how to sample frames with bash, what to record, and marking what you INFERRED apart from what you saw. That procedure is the skill's now, so this card does not restate it; three things are this card's alone. FIRST, WHEN THE CONTEXT NAMES NO REFERENCE YOU DO NOT STOP AND YOU DO NOT ASK. Invent no reference — but go and find the two or three videos already doing this format well in this niche, study those, and file the teardown from them, saying in the first line that they are yours and not the operator's. The reference question was asked at setup; unanswered is an answer, not a question to put back to them, and ask_operator parks your session with two cards waiting behind this one. SECOND, this is the study, done ONCE, on day one: `look` and `hook-style` are blocked on this card and plan the channel's look and voice from what you file, so file ONE pending post, no media, no stage, `source` \"reference teardown\", specific enough to plan a render from, and put its id in the note. THIRD, the split a plan turns on. Where you were given still URLs, copy them into the post exactly as the operator wrote them — those PUBLIC URLs are what a plan carries as `reference_frames`, and the producer passes the first as the piece's opening frame, so a URL you retyped is a render that fails. A fil_ still is the other half of that split and stops here: generate_video fetches a URL and refuses a fil_ id, so name one as a reference you looked at and never as a reference frame. Never name your own screenshots there either: a picture of a page is not a frame of the reference. Do not write hooks, scripts or briefs here: the cards behind this one do that, and they read what you filed.",
    }),
    task({
      key: "look",
      title: "Choose the style templates this channel renders in",
      assignee: "producer",
      blocked_by: ["reference-study"],
      body: "Day one is set-up, not a render. Read project_context for the niche, the tone and the audience, and the reference teardown the scriptwriter just filed (channel.list_posts, `source` \"reference teardown\" — its note names the post; where the operator named no reference, it is a teardown of real videos the scriptwriter went and found in this niche, and it is the standard either way). Then the style templates (channel.list_style_templates). Choose the one or two whose look is closest to the teardown's shot grammar, and file the choice as a pending post with no media and no stage, `source` \"style choice\", one line on why for each — the scriptwriter names a style template in every plan it writes and is blocked on this card, so the note it reads is what stops it choosing at random. Then look for generate_video in the tools you were offered this turn — that list is complete. If it is there, say so in the note and do not call request_tools: never request a tool you already hold, and never request one for a card you are not on. Only if it is missing, request exactly it with request_tools, once, and say in the note whether it was granted. Render nothing in this session: your card for the first render is a separate one and it waits on a plan.",
    }),
    task({
      key: "hook-style",
      title: "Write the channel's hook style, so the team works to one voice",
      assignee: "scriptwriter",
      blocked_by: ["reference-study"],
      body: `Day one is set-up, not scripts. Read project_context for the niche, the tone and the audience, and your own reference teardown (channel.list_posts, \`source\` "reference teardown" — the card you just closed; where the operator named no reference it is a teardown of videos you went and found yourself, so say in the post that the patterns are your reading and not a client's example). Then write the channel's hook style in five lines — the openings this audience stops for, the shape of a ${LENGTH_PHRASE} piece in beats, the voice, the caption shape, what never to say — and file it as a pending post with no media and no stage, \`source\` "hook style". Every line of this is derived from the teardown and says which of its patterns it came from: that is the difference between a house voice and a guess, and every plan this channel ever files is written to this post. Do not read the queue for briefs and do not invent one: the scout's five reach you on your next card, which the board opens once this one and the scout's are closed. Put the post's id in the note.`,
    }),
    task({
      key: "report-frame",
      title: "Set up the weekly report this channel will be measured against",
      assignee: "analyst",
      body: "Read project_context for the niche, the audience and the cadence, then the channel plan the manager filed (channel.list_posts, `source` \"channel plan\" — it is the card this one waited on, and its note names the post). Set up the report skeleton this channel will use every week: the post kinds it files, the metrics you will read for each and where they come from, and the week's target taken from the manager's slot count rather than invented here. File it as a pending post with no media, `source` \"report skeleton\", so the team can read what it will be measured against. Write no report today — there is nothing posted to report on, and your Monday 07:30 fire writes the first real one.",
      blocked_by: ["channel-plan"],
    }),
    task({
      key: "first-scripts",
      title: "Turn the first five briefs into video projects",
      assignee: "scriptwriter",
      body: `The briefs exist now — the scout's card closed, and its note names the five post ids. Read project_context, your own reference teardown and hook style posts and the producer's style choice post (channel.list_posts), then every row at stage brief (channel.list_posts, stage brief). Claim each before you write it — channel.update_post, stage scripting, expected_stage brief; a refusal means another session has that row, so skip it. Work each claimed row in this order: FIRST open the exemplars the brief names — browser for the page and its stills, bash to pull the video and sample frames across it, close through the first three seconds and sparser after (\`naive/reference-teardown\` is the procedure) — then research the topic (web_search, web_fetch) until you have two or three claims you can source, write three hooks and keep one, lay the piece out in beats — hook, setup, turn, payoff, cta — and only then cut those beats into shots. File it as one video project (channel.create_project, kind generation, post_id the row, your name as agent): title and brief; hook, verbatim; rejected_hooks and why the kept one won; retention, what holds them past 0:03 and past 0:07; the scenes in order, each with its beat, render prompt inside a style template the producer actually chose, seconds, voiceover line and on-screen text, the seconds summing to ${LENGTH_PHRASE} — they render as ONE video, so that sum is its length; the exemplar and the moment each scene's grammar came from, and on a scene you cannot attribute, that you invented it; facts with their sources; sound; cta; a video model; reference_pattern; and the hashtagged caption. Filing it moves the row to stage scripted. Do not hand off to the producer: its card is blocked on this one and the board wakes it. Put the project ids in the note.`,
      blocked_by: ["first-briefs", "hook-style", "look"],
    }),
    task({
      key: "first-render",
      title: "Render the channel's first piece from the first plan",
      assignee: "producer",
      body: `There is a plan now — the scriptwriter's card closed, and its note names the project ids. Take the oldest planned generation project (channel.list_projects, status planned, kind generation) and claim it before you spend anything: channel.update_project, status rendering, expected_status planned; refused means another has it, so take the next. Read the plan in full (channel.get_project). It comes back with \`render_prompt\` — its shots already compiled into the one prompt this piece renders as, because nothing here joins clips — and \`render_seconds\`, their sum, which is ${LENGTH_PHRASE}. Call generate_video once with exactly that prompt, seconds \`render_seconds\`, aspect_ratio 9:16 and the plan's model. Do not rewrite the prompt, do not summarise it, and do not drop a shot to make it shorter — the plan was checked when it was filed. Wait for the file. Finish it: channel.update_project, status rendered, expected_status rendering, the video as \`media_url\`, your name as \`agent\`. Refused there means it moved on while you rendered: say so and stop rather than render a second time — a rendered plan is one the channel has already paid for, and this one costs about $${(ONE_RENDER_MICRO_USD / 1_000_000).toFixed(2)}. ONE piece today, not five; your 07:00 fire takes the next one tomorrow. Name the project you rendered in the note, and its reference_pattern where it has one.`,
      blocked_by: ["first-scripts"],
    }),
  ],

  // The FALLBACK target only: `PLATFORM_QUESTION` below asks the customer where this channel
  // posts, and a filed post takes their answer. This is what an install with no usable answer
  // falls back to, and it is the question's own first option so the two never disagree.
  platform: PLATFORM_CHOICES[0]!.platform,

  kinds: [
    { id: "produced", label: "Produced" },
    { id: "multi", label: "Multi-part" },
  ],

  /**
   * Four, and the fourth is the optional one — the engine refuses a fifth, and refuses a fourth
   * that is not optional in spirit (`templates/template.ts`, `SetupQuestion`; ADR-0757).
   *
   * The slot `PLATFORM_QUESTION` takes was `audience` — "Tone and audience, in one line" — and that
   * question is still the first thing the channel manager asks the operator in its day-one session.
   * Where a channel posts cannot be asked later: the crew starts filing within the minute, and every
   * row it files carries a target.
   *
   * *** `REFERENCE_QUESTION` SITS THIRD, BEFORE THE CADENCE, AND THAT ORDER IS THE POINT. *** The
   * form reads as one thought: what this channel is about, where it goes, what it should be LIKE,
   * and how often. Putting the optional one last would make it the thing a person scrolls past
   * after they have mentally finished; putting it beside the other two questions about the CHANNEL
   * — rather than beside the one about the schedule — is what makes it read as part of describing
   * the channel. It is still the only one that may be left blank, and a channel installed without
   * it behaves exactly as this template did before the question existed.
   */
  questions: [
    {
      key: "niche",
      label: "Niche",
      type: "choice",
      options: [
        "Stoicism & philosophy",
        "True crime recaps",
        "Space & astronomy",
        "Personal finance",
        "History mysteries",
        "Health & longevity",
      ],
      help: "Pick one or type your own — every brief, script and render is for this niche. Your tone and who it is for is the first thing the channel manager will ask you about.",
    },
    PLATFORM_QUESTION,
    REFERENCE_QUESTION,
    CADENCE_QUESTION,
  ],

  words: {
    queueSubtitle: "Everything the producer made, on its way to your accounts.",
    queueEmpty: "Brief the producer in Chat and each finished video lands here for review.",
    plansSubtitle: "Every video the scriptwriter planned — hook, beats and shots — and what the producer has made of it.",
    plansEmpty: "The scriptwriter plans each brief here in full — the hook, the beats, the facts and their sources, the sound and the look — before the producer spends a render on it.",
  },
};
