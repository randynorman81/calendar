import { getStore } from "@netlify/blobs";

const JSON_HEADERS = { "Content-Type": "application/json" };

// ---------- Schedule config ----------
// Every class period Mr. Norman teaches. `dayType` is "A" or "B" -- A-day
// slots meet Mon/Wed (+ Fridays set to A), B-day slots meet Tue/Thu (+
// Fridays set to B). To add a new period: add one object here.
const SLOTS = [
  { id: "1A", course: "APCSP", label: "Period 1 — APCSP", dayType: "A" },
  { id: "2B", course: "APCSP", label: "Period 2 — APCSP", dayType: "B" },
  { id: "3A", course: "IST", label: "Period 3 — IST", dayType: "A" },
  { id: "3B", course: "IST", label: "Period 3 — IST", dayType: "B" },
  { id: "4A", course: "IST", label: "Period 4 — IST", dayType: "A" },
  { id: "4B", course: "EC", label: "Period 4 — EC", dayType: "B" }
];

// Directed sync rules: adding an event to `from` also adds it to `to`.
//   mode "same-day"  -> partner event lands on the identical calendar date
//   mode "cross-day" -> partner event lands on that slot's next meeting date
// 3B only *receives* from 3A/4A (it doesn't push back out) -- entering an
// event directly on 3B stays put unless told otherwise. 4B (EC) has no
// sync partner at all.
const SYNC_RULES = [
  { from: "1A", to: "2B", mode: "cross-day" },
  { from: "2B", to: "1A", mode: "cross-day" },
  { from: "3A", to: "4A", mode: "same-day" },
  { from: "4A", to: "3A", mode: "same-day" },
  { from: "3A", to: "3B", mode: "cross-day" },
  { from: "4A", to: "3B", mode: "cross-day" }
];

function slotById(id) {
  return SLOTS.find((s) => s.id === id);
}

function syncRulesFrom(id) {
  return SYNC_RULES.filter((r) => r.from === id);
}

// No-school days for the 2026-2027 school year, from the official Social
// Circle City Schools calendar (socialcircleschools.com/about-us/calendars).
// Early-release days (Oct 9, Dec 18, Mar 19, May 28) are NOT included here
// since classes still meet that day, just on a shorter schedule.
const HOLIDAYS = new Set([
  "2026-09-07", // Labor Day
  "2026-09-08", // Student Holiday / Staff Professional Learning
  "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", // Fall Break
  "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", // Thanksgiving
  "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-25", // Christmas Holidays wk 1
  "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", // Christmas Holidays wk 2
  "2027-01-04", "2027-01-05", // Student Holidays / Professional Learning
  "2027-01-18", // MLK Day
  "2027-02-15", "2027-02-16", "2027-02-17", "2027-02-18", "2027-02-19", // Winter Break
  "2027-04-05", "2027-04-06", "2027-04-07", "2027-04-08", "2027-04-09" // Spring Break
]);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayName(dateStr) {
  // Parse as a local calendar date (not UTC midnight) to avoid off-by-one
  // weekday bugs across time zones.
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function slotMeetsOnDate(slot, dateStr, fridayTypes) {
  if (HOLIDAYS.has(dateStr)) return false;
  const wd = weekdayName(dateStr);
  if (slot.dayType === "A") {
    if (wd === "Monday" || wd === "Wednesday") return true;
    if (wd === "Friday") return fridayTypes[dateStr] === "A";
    return false;
  }
  if (wd === "Tuesday" || wd === "Thursday") return true;
  if (wd === "Friday") return fridayTypes[dateStr] === "B";
  return false;
}

// Next date (after dateStr) that the given slot meets. Scans forward up to
// 21 days -- if no Friday type is set far enough ahead, this can come back
// null, which the caller treats as "can't auto-sync yet."
function nextMeetingDate(slot, afterDateStr, fridayTypes) {
  for (let i = 1; i <= 21; i++) {
    const candidate = addDays(afterDateStr, i);
    if (slotMeetsOnDate(slot, candidate, fridayTypes)) return candidate;
  }
  return null;
}

function store() {
  return getStore("class-calendar");
}

async function readJSON(key, fallback) {
  const val = await store().get(key, { type: "json" });
  return val || fallback;
}

// Read-modify-write with an ETag conditional write, retrying on conflict.
// Two admin requests landing at the same moment (or two synced writes from
// one addEvent call in quick succession) would otherwise race: both read
// the same starting array, and whichever write finishes last silently wipes
// out the other's change. This makes that impossible -- a write only lands
// if nothing else changed the key since we read it.
async function updateJSON(key, fallback, updater) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await store().getWithMetadata(key, { type: "json" });
    const current = existing ? existing.data : fallback;
    const updated = updater(current == null ? fallback : current);
    const writeOpts = existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true };
    const result = await store().setJSON(key, updated, writeOpts);
    if (result.modified) return updated;
  }
  throw new Error(`Too much contention writing "${key}" -- try again`);
}

function newId() {
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

async function publicEvents(slotId) {
  const slot = slotById(slotId);
  if (!slot) return { error: "Unknown period" };
  const events = await readJSON("events", []);
  const forSlot = events
    .filter((e) => e.slotId === slotId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ id: e.id, date: e.date, title: e.title, notes: e.notes || "", type: e.type }));
  return { ok: true, slot: { id: slot.id, label: slot.label, course: slot.course }, events: forSlot };
}

async function adminEvents() {
  const events = await readJSON("events", []);
  return { ok: true, slots: SLOTS, syncRules: SYNC_RULES, events: events.sort((a, b) => a.date.localeCompare(b.date)) };
}

async function addEvent(body) {
  const slotId = (body.slotId || "").trim();
  const date = (body.date || "").trim();
  const title = (body.title || "").trim();
  const notes = (body.notes || "").trim();
  const type = body.type === "quiz" || body.type === "test" ? body.type : "assignment";

  const slot = slotById(slotId);
  if (!slot) return { error: "Unknown period" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date" };
  if (!title) return { error: "Title is required" };

  const fridayTypes = await readJSON("fridayTypes", {});
  if (!slotMeetsOnDate(slot, date, fridayTypes)) {
    if (HOLIDAYS.has(date)) return { error: `${date} is a school holiday/break -- no classes meet that day.` };
    const wd = weekdayName(date);
    if (wd === "Friday") return { error: `${date} is a Friday whose A/B type hasn't been set yet. Set it first under "Friday A/B Days."` };
    return { error: `${slot.label} (${slot.dayType}-day) doesn't meet on ${wd}s.` };
  }

  let created = [];
  await updateJSON("events", [], (events) => {
    created = [];
    const linkId = newId();

    const primary = { id: newId(), slotId, date, title, notes, type, linkId, timestamp: new Date().toISOString() };
    events.push(primary);
    created.push(primary);

    for (const rule of syncRulesFrom(slotId)) {
      const partnerSlot = slotById(rule.to);
      const partnerDate = rule.mode === "same-day" ? date : nextMeetingDate(partnerSlot, date, fridayTypes);
      if (partnerDate) {
        const mirrored = { id: newId(), slotId: rule.to, date: partnerDate, title, notes, type, linkId, timestamp: new Date().toISOString() };
        events.push(mirrored);
        created.push(mirrored);
      }
    }

    return events;
  });

  return { ok: true, created };
}

async function editEvent(body) {
  const id = body.id;
  const title = (body.title || "").trim();
  const notes = (body.notes || "").trim();
  if (!title) return { error: "Title is required" };

  let notFound = false;
  let count = 0;
  // Title/notes cascade to every event sharing the same linkId, so synced
  // pairs never drift out of sync. The date isn't editable here -- delete
  // and re-add if the date needs to change, so sync partners stay correct.
  await updateJSON("events", [], (events) => {
    const target = events.find((e) => e.id === id);
    if (!target) { notFound = true; return events; }
    count = 0;
    events.forEach((e) => {
      if (e.linkId === target.linkId) {
        e.title = title;
        e.notes = notes;
        count++;
      }
    });
    return events;
  });

  if (notFound) return { error: "Event not found" };
  return { ok: true, updated: count };
}

async function deleteEvent(body) {
  const id = body.id;
  let notFound = false;
  let removed = 0;

  await updateJSON("events", [], (events) => {
    const target = events.find((e) => e.id === id);
    if (!target) { notFound = true; return events; }
    const remaining = events.filter((e) => e.linkId !== target.linkId);
    removed = events.length - remaining.length;
    return remaining;
  });

  if (notFound) return { error: "Event not found" };
  return { ok: true, removed };
}

async function getFridayTypes() {
  const fridayTypes = await readJSON("fridayTypes", {});
  return { ok: true, fridayTypes };
}

async function setFridayType(body) {
  const date = (body.date || "").trim();
  const type = body.type;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date" };
  if (weekdayName(date) !== "Friday") return { error: `${date} isn't a Friday.` };
  if (type !== "A" && type !== "B") return { error: "Type must be A or B" };

  await updateJSON("fridayTypes", {}, (fridayTypes) => {
    fridayTypes[date] = type;
    return fridayTypes;
  });
  return { ok: true };
}

export default async (req) => {
  function ok(obj) {
    return new Response(JSON.stringify(obj), { status: 200, headers: JSON_HEADERS });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action") || "";
      if (action === "slots") return ok({ ok: true, slots: SLOTS });
      if (action === "publicEvents") return ok(await publicEvents(url.searchParams.get("slot") || ""));
      if (action === "fridayTypes") return ok(await getFridayTypes());
      if (action === "holidays") return ok({ ok: true, holidays: Array.from(HOLIDAYS).sort() });
      return ok({ error: "Unknown action" });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch (err) {
        return ok({ error: "Malformed request" });
      }

      const action = body.action;
      const adminPin = process.env.ADMIN_PIN || "1234";
      if (body.pin !== adminPin) {
        return ok({ error: "Invalid PIN" });
      }

      switch (action) {
        case "verifyPin":
          return ok({ ok: true });
        case "adminEvents":
          return ok(await adminEvents());
        case "addEvent":
          return ok(await addEvent(body));
        case "editEvent":
          return ok(await editEvent(body));
        case "deleteEvent":
          return ok(await deleteEvent(body));
        case "setFridayType":
          return ok(await setFridayType(body));
        default:
          return ok({ error: "Unknown action" });
      }
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: JSON_HEADERS });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: JSON_HEADERS });
  }
};
