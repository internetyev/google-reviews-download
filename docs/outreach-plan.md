# Outreach plan — local-SEO communities

_Status: draft for human review. Do **not** start outreach until the cross-post checklist in `docs/launch-checklist.md` is signed off and the launch posts in `docs/launch-posts.md` are live._

This is the community-by-community plan, separate from the broadcast launch posts (PH / IH / LinkedIn) drafted in `launch-posts.md`. Broadcast posts are "here's a thing I made"; community outreach is "here's a thing that solves the problem you discussed last Tuesday." Different cadence, different tone, different gating.

## Audience recap (from PLAN.md)

- **Primary:** local-SEO consultants and agency analysts pulling reviews for client work.
- **Secondary:** SMB owners who want a backup; ORM analysts; marketing teams pulling quotes.
- **Anti-audience:** people looking to scrape competitor reviews at scale. Every post must reinforce that this is for businesses you own or work with.

## Tone rules (apply to every channel)

1. **Useful first, promotional second.** If the post would still be worth reading with the link removed, it's good. If not, rewrite.
2. **Answer-shaped, not announcement-shaped.** The best outreach is replying to an existing question with the tool as one option among several, not starting a new "I built a thing" thread.
3. **Disclose authorship every time.** "Disclosure: I built this" in the same post, not buried.
4. **Never the first thing posted in a channel that day.** Read the room before posting.
5. **Do not DM strangers.** Public-thread replies only. DMs only to people who explicitly opened the door (replied to your post, asked for the link).
6. **Stop on negative signal.** If a moderator removes one post, do not post in that channel again until you've messaged the mod and gotten an explicit OK.

## Pre-flight gates (must be true before any outreach starts)

- [ ] L5.2 (Vercel deploy) merged and the live URL is publicly reachable
- [ ] L2.8 (rate-limit middleware) live — community traffic will probe it
- [ ] L2.10 (Plausible analytics) running so we can attribute traffic to channels via UTM tags
- [ ] L4.1 (real SF creds) merged — outreach with mock data is dishonest
- [ ] "Not affiliated with Google" disclaimer visible on the live site
- [ ] All three broadcast posts (`launch-posts.md`) live — community outreach is the *follow-up* wave, not the opener

If any gate is unchecked, **stop**. Outreach amplifies whatever the site currently is — broken or polished.

## UTM convention

Tag every outreach link so Plausible can separate channels:

```
?utm_source=<channel-slug>&utm_medium=community&utm_campaign=launch-2026
```

Channel slugs: `reddit-bigseo`, `reddit-localseo`, `reddit-smallbusiness`, `localsearchforum`, `localu`, `seosignals-slack`, `traffickthinktank`, `agencyanalytics-slack`, `serountable`, `twitter-localseo`, `linkedin-groups`, `whitespark-blog-comments`.

Keep one slug per channel; do not mint variants per thread.

---

## Channels (priority order)

Posts go out **one channel per weekday**. Two-week cadence — week 1 is the warm channels (forums where the founder has prior history), week 2 is the cold channels. Do not batch-post; the goal is sustained low-volume presence, not a spike.

### Week 1 — warm channels (founder has read these for years)

#### 1. Sterling Sky's **Local Search Forum** (https://www.localsearchforum.com)
- The single highest-signal local-SEO forum. Mods (Joy Hawkins's team) are strict about self-promo; read their posting rules before the first reply.
- **Plan:** subscribe to the "Citations & Local Listings" and "Reputation Management" subforums for one week before posting. Reply to existing review-export questions only. Lead with how to solve the asker's problem; mention the tool only if it's the cleanest answer. Disclosure line mandatory.
- **Do not** start a "I built this, what do you think?" thread. That's a fast removal.

#### 2. **r/bigseo** (https://reddit.com/r/bigseo)
- Mid-traffic, technically literate, low spam tolerance. Self-promo allowed only via the weekly thread (check the sidebar for current day).
- **Plan:** post a single comment in the weekly self-promo thread the first week it goes up post-launch. Two short paragraphs: what it is, what it isn't (no batch, no scraping). Link with UTM. Engage with every reply within 24h.
- **Do not** post outside the self-promo thread until at least one organic question about review export comes up. Then reply, with disclosure.

#### 3. **LocalU community** (https://localu.org — paid forum, founder has a seat)
- Smallest audience but highest conversion to paying users (consultants).
- **Plan:** one post in the "Tools & Tactics" channel. Lead with the Excel-CSV gotcha (UTF-8 BOM + CRLF + QUOTE_ALL — the kind of detail this audience will actually nod at). Tool as the worked example.

### Week 2 — cold channels (no founder history, post carefully)

#### 4. **r/SEO** (https://reddit.com/r/SEO)
- Larger and noisier than r/bigseo. Self-promo rules vary; check sidebar.
- **Plan:** same as r/bigseo — weekly thread only, one comment, disclosure. If the mods kill r/bigseo's post, **do not also try r/SEO** that week; reassess.

#### 5. **r/smallbusiness** (https://reddit.com/r/smallbusiness)
- SMB owners (secondary audience). Mod rules tight; self-promo days are limited.
- **Plan:** answer-shaped only. Wait for a "how do I back up my Google reviews" or "exporting reviews for a case study" question, then reply with the tool plus two alternatives. Disclosure mandatory.

#### 6. **Traffic Think Tank Slack** (paid, founder has a seat)
- Agency-focused; ask channel mods before posting links. Some channels allow tool drops, most don't.
- **Plan:** post in `#tools` only, after asking the channel mod. One sentence + link. If declined, drop it.

#### 7. **AgencyAnalytics community Slack** (free, agency-led)
- Smaller, but exactly the buyer profile.
- **Plan:** intro thread first ("hi, I'm X, I work on local-SEO tooling"), then post the tool a week later in `#show-and-tell` if such a channel exists, else skip.

#### 8. **Search Engine Roundtable comments** (https://www.seroundtable.com)
- Barry Schwartz reads every comment. Posting a tool link in a comment is fine if the post is about reviews/local — never on unrelated posts.
- **Plan:** subscribe to the local-SEO tag for two weeks. Comment only when on-topic.

#### 9. **Twitter / X** (#LocalSEO, @-mentions of established voices)
- Low signal but cheap. **Never** @-mention someone with the link cold; reply to existing threads about review export.
- **Plan:** one announcement tweet from the founder account (mirror of the LinkedIn post in `launch-posts.md`), then reply-only for two weeks. No threads. No quote-tweets of competitors.

#### 10. **LinkedIn local-SEO groups**
- Generally low-signal, high-spam. One post per group, max.
- **Plan:** identify three groups with >2k members and recent (within 7 days) member activity. Post the LinkedIn launch text from `launch-posts.md`. If no engagement in 72h, do not repost in that group.

### Skip list (explicitly do not post)

- **Black Hat World, Warrior Forum** — wrong audience, will attract scrapers (anti-audience).
- **Facebook groups** — moderation is opaque, attribution is impossible (no UTM).
- **General "marketing" subreddits** (r/marketing, r/digital_marketing) — too broad; signal-to-noise is bad.
- **Cold email to agencies** — out of scope for the launch; revisit in a Phase 6 leaf if traffic plateaus.

---

## Per-channel measurement

Track in a simple table (manual, or a Plausible custom event per UTM source):

| Channel | First post date | Replies | Site clicks (UTM) | Downloads | Mod action? |
|---------|------|---------|-----------|-----------|-------------|
| (per row above) | | | | | |

Review the table at **T+14 days** post-launch. Channels with zero downloads and zero replies → drop. Channels with downloads but no replies → invest in a follow-up (a useful thread, not another link). Channels with mod action → leave them alone.

## Risk register (channel-specific)

| Risk | Mitigation |
|------|------------|
| Mod removes post for "self-promo without disclosure" | Disclosure line is mandatory in *every* post (not just the first). One template, not freestyle. |
| Anti-audience (scrapers) shows up in replies asking "can it pull competitor reviews" | Pinned reply: "It can pull any public Place ID's reviews; the tool is intended for businesses you own or represent. We don't moderate that, but please don't use it that way." |
| One channel goes viral and rate-limit middleware (L2.8) gets probed past its budget | Token-bucket already caps at 10 req/min/IP. If one channel spikes, raise the cap *only* after seeing Plausible attribution — don't preemptively widen. |
| Founder gets flamed in a community thread | Reply once, calmly, with facts. No second reply. Block-and-move-on if it escalates. Do not delete the original post. |

---

## Out of scope (for this leaf — revisit if needed)

- Paid sponsorships of local-SEO newsletters (Marie Haynes, Whitespark, BrightLocal). All would cost money and need a Phase 5 budget decision.
- Conference sponsorship (LocalU Forum, MozCon Local). Same reason.
- Direct outreach to ORM platforms (Birdeye, Podium) suggesting integration. That's a partnerships motion, not a launch motion.
- Cold email to specific agencies. Out of scope; revisit if T+14 numbers are flat.
