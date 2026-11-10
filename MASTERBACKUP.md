# MASTERBACKUP — known-good baseline

**Tag:** `masterbackup` → commit `c4fd9e0` (merge of PR #4, `main`)
**Date:** 2026-11-10 · **Status:** tagged, pushed, and listed as a GitHub Release.

This file is a written snapshot of *everything that is in the current site* at the
`masterbackup` point, so any later experiment (intro overlay, catalogue motion,
audio juggling) can be reverted or re-implemented without digging through git.

> Restore command (local):
> ```bash
> git fetch --tags
> git checkout -B restore/masterbackup masterbackup
> ```
> Or from GitHub: **Tags → masterbackup → … → Create branch**.

---

## 1. Merge history up to the backup

| # | PR title | Branch | What it did |
|---|---|---|---|
| 1 | Add intro overlay with auto-swipe catalogue + music | `arena/3ba6f441` | First full-screen entrance overlay, CSS carousel, `<audio>` element |
| 2 | Fix intro overlay music: local mp3 playlist, continuous loop | `arena/ed4a84b6` | Fixed 2-track local playlist, `ended` → next track, no shuffle |
| 3 | Fix intro audio playback | `arena/6575f20a` | No fake muted "playing" state, retryable playback, playlist error skipping, regression tests |
| 4 | **Intro overlay redesign, Start demo button, responsive homepage** | `arena/e4d4e571` | **← the "last PR", this is `masterbackup`** |

Merge commit of PR #4: `c4fd9e0d78a19180d7b7a70c235ef377f5e12cd8`
(https://github.com/rizwanahmedsora9-pixel/ams-builds.online/pull/4)

---

## 2. What PR #4 ("masterbackup") shipped

### 2.1 `src/components/IntroOverlay.astro` (net −66 lines, rewrote the bottom half)

**Layout**
- Full-screen `fixed inset-0 z-[9999]` dark (slate-950) overlay, scrollable
  (`overflow-y-auto overscroll-contain`) so it fits short/large screens.
- Centred column: `min-h-full flex flex-col` + `max-w-6xl` — header top,
  hero + carousel flex-1 centred, actions bottom. Works on 320 px → desktop.
- Ambient amber + sky blobs (`blur-[120px]`) behind the content, `aria-hidden`.
- Header: amber "A" mark + **AMS Builds / WEB & APP STUDIO** wordmark on the
  left, now-playing pill on the right.
- Hero copy: `LANDING-PAGE CATALOGUE` eyebrow, H1
  "Websites & apps that **convert.**", one-line subtitle.
- Frozen site content *behind* the overlay is inert: `document.body.style.overflow = 'hidden'`
  while the overlay is up, restored on exit.

**Catalogue / carousel**
- `#ams-carousel-track` — flex row, `translateX(-i*100%)`, 700 ms ease-in-out,
  `will-change-transform`. One `<article>` per slide, `min-width: 100%`.
- 5 slides, two-column on `md+` (copy left / preview right), stacked and
  re-ordered (`order-1`/`order-2`) on mobile:

  | # | Tag | Title | Preview image |
  |---|---|---|---|
  | 1 | SaaS · Dark mode | Scale your product. | `/images/uploads/project-software.jpg` |
  | 2 | E-commerce · Bright | Shop the new season. | `/images/uploads/project-retail.jpg` |
  | 3 | Business · Clean | Your business, online. | `/images/uploads/hero-dashboard.jpg` |
  | 4 | Agency · Bold | We build brands. | `/images/uploads/blog-gujrat-business.jpg` |
  | 5 | Android · Mobile | Apps that feel native. | `/images/uploads/project-android.jpg` |

- Auto-advance every **4000 ms**; pauses on `mouseenter`, resumes on
  `mouseleave`; clicking a dot jumps and restarts the timer.
- Dots `#ams-carousel-dots`: active dot is a 8×2 amber pill, inactive 2×2
  white/20 dots.
- `prefers-reduced-motion: reduce` disables the track transition and the
  equalizer animation.

**Audio engine** (`<audio id="ams-audio-player" preload="auto" playsinline>`)
- Fixed playlist, fixed order, **no shuffle**, `ended` → next track, loops:
  1. `/audio/baila-lento.mp3` — "BAILA LENTO" (84 BPM, 1:24)
  2. `/audio/tulin-tulin-phonk.mp3` — "Tulin Tulin" phonk (75 BPM, 1:35)
- Both files are local, committed under `public/audio/`.
- Autoplay is attempted on load; browsers usually block it → the
  **Start demo** button appears.
- `requestPlayback()` is called *directly inside the click handler* to keep the
  user-activation flag; a `playRequest` counter invalidates stale rejections.
- `audio.muted` / `volume` are forced to `false` / `1` — the overlay never
  pretends to play silently.
- `playing` event + `!muted && volume > 0` is the **only** thing that swaps the
  UI into the "playing" state.
- `error` handler steps through the playlist once (`consecutiveErrors`), then
  shows "Music is unavailable right now — you can still browse."
- `startBtn` click re-seeds a failed track (`audio.error` → `loadTrack(trackIndex)`).

**Now-playing UI**
- `#ams-start-demo` — white pill, black play triangle, text **"Start demo"**,
  `hidden` while music plays.
- `#ams-now-playing` — amber 4-bar equalizer only (`ams-eq-bar`,
  0.9 s scaleY keyframes, staggered 0/0.25/0.5/0.75 s), `role="status"`,
  `aria-label="Demo music playing"`. **No track names or artist names are ever
  rendered** — that is asserted by a test.
- `#ams-status` — `aria-live="polite"` hint line (empty while playing).
- Bottom caption: "Best with sound · Headphones recommended".

**Entering the site**
- `#ams-enter-btn` — amber pill "ENTER SITE →".
- `enterSite()`: pause audio, reset `currentTime`, strip `src` + `load()`,
  clear carousel timer, `sessionStorage.setItem('ams_intro_seen','1')`,
  add `opacity-0 pointer-events-none` + `data-exiting="true"`, then remove the
  node after **900 ms** and restore body scroll.
- `Escape` also dismisses (keydown listener). `Enter`/`Space` keep their native
  button behaviour — a test asserts Enter does **not** dismiss.
- Overlay shows **once per session** (`sessionStorage`, key `ams_intro_seen`);
  on repeat visits the component removes itself immediately.

### 2.2 `src/pages/index.astro` (+35 / −20, homepage)

- Hero: `py-14 sm:py-20 md:py-24`, `text-4xl sm:text-5xl lg:text-6xl`,
  `text-balance` headline, stacked CTAs on mobile → row on `sm+`.
- Stats row `dl` (3 columns) pulling from `site.stats`.
- Hero image card with `aspect-[1200/630]`, `onerror` hide, feature chips
  (SEO Ready / AdSense Ready / Mobile First), "⚡ Loads in < 1 second" badge
  repositioned for mobile.
- Services, AdSlot leaderboard, featured projects, "Why us", contact card.
- **New closing CTA band**: rounded-3xl slate-900 panel, amber glow blob,
  "Ready to launch your next website or app?", Get a Free Quote + WhatsApp.
- Consistent `py-16 md:py-20` section rhythm; blog section on `bg-slate-50`.

### 2.3 `src/styles/global.css` (+4 / −2)

- Tailwind base/components/utilities, `color-scheme: light`, smooth scroll.
- `.prose-ams` typography for CMS markdown (headings, links, tables, code).
- `.ad-slot` placeholders (leaderboard 90 px / rectangle 250 px / in-article 120 px).
- Mobile nav zero-JS checkbox hack + `header:has(#mobile-menu-toggle:checked)`
  icon swap (this fixed the hamburger/X toggle).

### 2.4 `tests/intro-audio.test.mjs` (5 passing)

Node's built-in test runner, loads the `<script>` out of the Astro component and
runs it in a `vm` context with stub elements. Covers:

1. Start demo starts playback after a blocked autoplay; stale rejection ignored.
2. While playing, only the equalizer is shown — no track/artist name anywhere.
3. Blocked playback shows the Start demo button + hint, not a now-playing claim.
4. Failed tracks stop after one playlist cycle and can be retried.
5. Keyboard: Enter does not dismiss the intro, Escape does.

Run: `node --test tests/intro-audio.test.mjs`

---

## 3. Rest of the site at this point (unchanged by PR #4)

- **Stack:** Astro 4.16, Tailwind 3.4, `@astrojs/sitemap`, `@astrojs/rss`,
  Decap CMS. Static output, `build.format: 'directory'`.
- **CMS:** `/admin/` (Decap) — Site Settings singleton, Pages, Projects, Blog.
- **Content:** `src/content/settings/site.yml` (brand, contact, hero, stats,
  Google/Analytics/AdSense flags) · 5 pages · 3 projects · 4 blog posts.
- **Components:** SEO, Header (sticky, zero-JS mobile menu), Footer, AdSlot,
  ProjectCard, BlogCard, Breadcrumbs, IntroOverlay.
- **Layouts:** BaseLayout (mounts `IntroOverlay` before everything),
  PageLayout, BlogPostLayout, ProjectLayout.
- **Pages:** `/`, `[...slug]`, `/blog/`, `/blog/[...slug]`, `/projects/`,
  `/projects/[...slug]`, `/404`, `/rss.xml`.
- **Assets:** 9 images in `public/images/uploads/` (all 1200×630),
  2 mp3s in `public/audio/`, `favicon.svg`, `robots.txt`, `_headers`.

---

## 4. Known gaps at `masterbackup` (what the next round fixes)

1. The **Start demo button sits in the footer** of the overlay, so on a phone it
   is only visible after scrolling — the user wants it **centred in the first
   viewport on every device**.
2. The overlay is **only music + a carousel**; there is no full-page "demo
   stage", no enlarge/fullscreen affordance, and nothing plays until the button
   is clicked.
3. The carousel advances on a fixed 4 s timer — it is **not synced to the beat**
   of the track that is playing.
4. Slide "previews" are flat marketing cards (`project-*.jpg`), not real
   website/app screenshots — the user wants **actual catalogue pictures**.
5. No way to hear the music without committing to the full intro.

---

---

## 5. Next round (branch `arena/1c6eb51f-ams-builds-online`) — what changed after the backup

The items in §4 were addressed in the follow-up PR:

- **Centred DEMO gate.** The overlay is now exactly `100dvh` and never scrolls;
  header and footer are positioned absolutely, the stage is centred in the
  full viewport, so the single round **DEMO** button is dead-centre on every
  device (phone, tablet, desktop, landscape, short screens).
- **Nothing is revealed until it is pressed.** The gate is a heavy
  (`bg-slate-950/90 backdrop-blur-2xl`) cover over the stage. The old
  "Start demo" pill in the footer and the "Enter site" button are gone; there
  is one demo control plus a quiet "Skip to website" link.
- **Pressing DEMO plays the music and runs the catalogue** — the gate blurs
  away, the controls fade in and the catalogue starts swiping immediately.
- **Beat-synced swipes.** Each playlist entry carries its measured tempo
  (`baila-lento` 84 BPM, `tulin-tulin-phonk` 75 BPM); a `requestAnimationFrame`
  beat clock advances the slide every **8 beats** and pulses an amber ring on
  every single beat. The 640 ms swipe transition lands on the next beat.
  Idle (gate closed) keeps a gentle 4 s drift so the screen is never static.
- **Enlarge button.** "Expand" blows the stage up to the whole page
  (`100dvh`, controls pinned to the bottom, close `⤡` button top-right);
  the same button becomes "Shrink". `Escape` leaves full-page mode first.
- **Real catalogue pictures** — five new AI-rendered site/app screenshots in
  `public/images/uploads/`: `demo-saas-dashboard.jpg`,
  `demo-shop-storefront.jpg`, `demo-business-site.jpg`,
  `demo-brand-agency.jpg`, `demo-android-app.jpg`. The active one is also used
  as the blurred ambient backdrop.
- Arrow keys ←/→, prev/next buttons and dots all work once the demo runs.
- Tests: `node --test tests/intro-audio.test.mjs` — **8 passing** (gate closed
  by default, demo opens the stage, music failure never blocks the demo,
  no track names, expand/shrink, Escape order, markup checks).

*Written 2026-11-10. Keep this file as the historical description of
`masterbackup`.*
