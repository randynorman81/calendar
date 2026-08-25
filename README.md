# Class Calendar

Per-class-period calendar for quizzes, tests, and assignments, with automatic
syncing between periods that share the same lesson.

## How it works

- **The website** (this folder) is static HTML/CSS/JS.
- **The data** (events + Friday A/B settings) lives in **Netlify Blobs**, the
  same free built-in database Bank Points uses.
- **Reads/writes** go through one Netlify Function (`netlify/functions/data.js`).

One page, `index.html`. Students pick their period and click a day to see
what's due. Click "Teacher sign in" (top of the page) and enter the PIN, and
that same calendar becomes editable in place: click a day to add/edit/delete
its events, or to set a Friday's A/B type if it hasn't been set yet.

## The schedule this is built around

- **A days** (Mon/Wed, or a Friday set to A): `1A` APCSP, `3A` IST, `4A` IST
- **B days** (Tue/Thu, or a Friday set to B): `2B` APCSP, `3B` IST, `4B` EC

Friday doesn't follow a fixed A/B formula (it shifts around holidays), so you
set it manually, one Friday at a time — click an unset Friday while signed in
and you'll get a prompt to mark it A or B before you can add an event there.

## How syncing works

Adding an event to a period can automatically add it to another:

| Add to | Also adds to | When |
|---|---|---|
| `1A` | `2B` | that period's *next* meeting (cross-day) |
| `2B` | `1A` | that period's *next* meeting (cross-day) |
| `3A` | `4A` | the *same* date (same-day) |
| `4A` | `3A` | the *same* date (same-day) |
| `3A` or `4A` | `3B` | `3B`'s *next* meeting (cross-day) |

`3B` doesn't push back out to `3A`/`4A` on its own, and `4B` (EC) has no sync
partner at all — both stay independent unless you tell me to change that.

Editing or deleting a synced event updates every copy at once (they all share
a `linkId` behind the scenes), so they can't drift out of sync.

**To change the schedule or sync rules:** edit the `SLOTS` and `SYNC_RULES`
arrays at the top of `netlify/functions/data.js`.

## A note on read timing

Right after adding/editing/deleting an event, a page that immediately
re-fetches the list can occasionally show the old data for a couple
seconds before catching up (Netlify Blobs' global replication has a brief
lag). Writes themselves are safe -- two people saving at the same instant
won't clobber each other's data -- it's only that a read fired *immediately*
after a write can be momentarily stale. Refreshing a few seconds later
always shows the correct result.

## Holidays

`netlify/functions/data.js` has a `HOLIDAYS` list (pulled from the official
2026-2027 Social Circle City Schools calendar) that blocks events — and the
auto-sync "next meeting" search — from landing on a day school isn't in
session. Early-release days aren't included since classes still meet those
days. Update that list each year from
[socialcircleschools.com/about-us/calendars](https://www.socialcircleschools.com/about-us/calendars).

## One-time setup

Same as Bank Points and the other class tools:

1. Push this folder to a new GitHub repo.
2. In Netlify: **Add new site → Import an existing project** → pick the repo → Deploy.
3. Set your PIN: **Site configuration → Environment variables** → add `ADMIN_PIN` →
   **Deploys → Trigger deploy → Deploy site** so the Function picks it up.
   (Defaults to `1234` if you skip this.)

## Local preview

No Node/Python needed — run the included PowerShell static server:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\serve.ps1 -Port 8091
```

Then open `http://localhost:8091/index.html`. Note: anything that calls the
Function (PIN check, events) won't work locally this way since there's no
Function running — only real on Netlify. Static layout/markup can still be
checked locally.
