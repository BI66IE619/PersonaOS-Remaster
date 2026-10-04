import {
  liftProgress,
  plateaus,
  sleepDebt,
  sleepVsEnergy,
  vitalityTrend,
  weightTrend,
} from "@/lib/insights";
import { bestStreak, currentStreak } from "@/lib/streaks";
import { sportWeek } from "@/lib/sports";
import { liftingStreak, sessionProgress } from "@/lib/strength";
import { addDays, relativeDayLabel, timeLabel } from "@/lib/dates";
import { categoryLabel } from "@/lib/categories";
import type {
  BriefInput,
  CalendarLine,
  Finding,
  MentorBrief,
  NoteExcerpt,
} from "@/lib/mentor/types";

/** Notes are the only free text in the app, and 20 000 characters is the store's
 *  own cap. Ten entries at 600 characters keeps the numbers in charge: a full
 *  fortnight of long entries would be more tokens than every number here put
 *  together, and the model would end up reflecting the journal back rather than
 *  reading the trends. */
const NOTE_COUNT = 10;
const NOTE_CHARS = 600;

/** The plan is the one thing sent with no switch, because it is the user's own
 *  typing about their own week and there is nothing in it that identifies
 *  anyone else. The titles are also the clearest statement of intent anywhere in
 *  the app, so leaving them out would cost more than it buys. */
const TASK_TITLES = 12;
const TASK_TITLE_CHARS = 80;

/** Last week and the next two.
 *
 *  Events have no lower bound and no horizon: nothing prunes them, and the
 *  calendar can be scrolled to any month, so a store that has been open for a
 *  year holds a year of them. Something has to bound what leaves the device, and
 *  this is the window in which an event can still say something — last week can
 *  explain a bad night, and the fortnight ahead is what a question about
 *  capacity is actually about. */
const EVENT_PAST_DAYS = 7;
const EVENT_FUTURE_DAYS = 14;

/** A cap as well as a window, for a store that can hold a lot of events inside
 *  three weeks. Sorted by date, so the earliest are kept. */
const EVENT_COUNT = 40;

/** What is actually sent, assembled from the app's own readings.
 *
 *  Pure on purpose: it takes everything it needs as arguments and touches no
 *  store, no window and no network, so the whole privacy boundary of this
 *  feature is one function that can be tested by calling it. If a field is not
 *  assembled here it does not leave the device, which is a much easier promise
 *  to keep than a rule about what the model is allowed to look at.
 *
 *  The cost of that design is that the numbers have to be written out twice —
 *  once for the panel and once as a sentence — so `read` leans on the verdict
 *  strings insights.ts already writes rather than inventing a second phrasing.
 */
export function buildBrief(input: BriefInput): MentorBrief {
  const { today, view, shareNotes, shareEvents } = input;
  const findings: Finding[] = [];

  /* ---- today ---- */
  findings.push({
    key: "readiness",
    label: "Readiness today",
    read: view.verdict,
    facts: [
      `score ${view.readiness.score} of 100, band "${view.readiness.band}"`,
      `sleep ${view.lastNight.totalMin}min, efficiency ${view.lastNight.efficiency}%`,
      `steps ${view.today.steps} of ${view.today.stepGoal}`,
      `active ${view.today.activeMin}min, load ${view.today.loadScore}`,
    ],
    sample: "tonight and the last 30 days",
    /* The score is built from 30 days of baselines, so it is never thin. */
    sufficient: true,
  });

  if (view.drivers.length) {
    findings.push({
      key: "drivers",
      label: "What is driving it",
      read: "The signals furthest from your own baseline.",
      facts: view.drivers.map((d) => `${d.label}: ${d.value} (${d.delta})`),
      sample: `top ${view.drivers.length} of 5 weighted signals`,
      sufficient: true,
    });
  }

  /* ---- sleep ---- */
  const debt = sleepDebt(view.sleepSeries);
  findings.push({
    key: "sleepDebt",
    label: "Sleep debt",
    read: debt.verdict,
    facts: [
      `your median ${debt.medianMin}min over ${debt.nights} nights`,
      `owed ${debt.debtMin}min across ${debt.nightsBelow} nights`,
    ],
    sample: `${debt.nights} nights`,
    sufficient: debt.enough,
  });

  const energy = sleepVsEnergy(view.sleepSeries, input.checkIns);
  findings.push({
    key: "sleepVsEnergy",
    label: "Sleep and how you felt",
    read: energy.verdict,
    facts: [
      `${energy.shortNights} short nights averaged energy ${energy.shortEnergy}`,
      `${energy.longNights} long nights averaged energy ${energy.longEnergy}`,
      `difference ${energy.diff}`,
    ],
    sample: `${energy.shortNights} short vs ${energy.longNights} long nights`,
    sufficient: energy.enough,
  });

  /* ---- body ---- */
  const weight = weightTrend(input.weightLogs, today);
  findings.push({
    key: "weight",
    label: "Weight",
    read: weight.verdict,
    facts: [
      weight.latestLb === null ? "no weigh-ins logged" : `latest ${weight.latestLb}lb`,
      weight.perWeek === null ? "no slope yet" : `${weight.perWeek}lb per week`,
      `status ${weight.status}`,
    ],
    sample: `${weight.entries} weigh-ins`,
    sufficient: weight.enough,
  });

  /* ---- training ---- */
  const lifts = liftProgress(input.strength, today);
  if (lifts.length) {
    findings.push({
      key: "lifts",
      label: "Lifts",
      read: "Best estimated one-rep max per movement, and the set behind each one.",
      facts: lifts.map(
        (l) =>
          `${l.name}: ${l.bestLb}lb (${l.bestWeightLb}lb x ${l.bestReps}, ${relativeDayLabel(
            l.bestDate,
            today,
          )}, ${l.sessions} sessions${l.gainLb === null ? "" : `, ${signed(l.gainLb)}lb on a month ago`})`,
      ),
      sample: `${lifts.length} movements`,
      sufficient: true,
    });
  }

  const stalls = plateaus(input.strength, today).filter((p) => p.sessionsSince > 0);
  if (stalls.length) {
    findings.push({
      key: "plateaus",
      label: "Stalled lifts",
      read: stalls.map((p) => p.verdict).join(" "),
      facts: stalls.map(
        (p) =>
          `${p.name}: ${p.trend}, ${p.sessionsSince} sessions, ${
            p.daysSince === null ? "unknown" : `${p.daysSince} days`
          } since the best`,
      ),
      sample: `${stalls.length} movements`,
      sufficient: true,
    });
  }

  const streak = liftingStreak(input.strength, today);
  const progress = sessionProgress(input.strength, today);
  findings.push({
    key: "training",
    label: "Training",
    read: "The run of days on which every movement with a target was actually finished.",
    facts: [
      `lifting streak ${streak} days`,
      `today ${progress.done} of ${progress.total} movements finished`,
    ],
    sample: "logged sets only",
    sufficient: true,
  });

  const week = sportWeek(input.sports, today);
  findings.push({
    key: "sport",
    label: "Sport",
    read: week.firstWeek
      ? "The first week on record, so there is nothing to compare it against yet."
      : "This week against the same number of days a week earlier.",
    facts: [
      `${week.current.sessions} sessions, ${week.current.minutes}min, ${week.current.trainedDays} trained days`,
      `${week.current.restDays} rest days`,
      `same point last week: ${week.previous.sessions} sessions, ${week.previous.minutes}min`,
    ],
    sample: `${week.current.days} days of the week`,
    sufficient: !week.firstWeek && (week.current.sessions > 0 || week.previous.sessions > 0),
  });

  /* ---- vitality ---- */
  const vitality = vitalityTrend(view.sparks);
  findings.push({
    key: "vitality",
    label: "Vitality trend",
    read: vitality.verdict,
    facts:
      vitality.current === null
        ? ["not enough history"]
        : [
            `currently ${vitality.current}`,
            vitality.change === null ? "no change yet" : `${signed(vitality.change)} over the window`,
            `night ${vitality.night}, training ${vitality.training}`,
          ],
    sample: `${vitality.points.length} days`,
    sufficient: vitality.enough,
  });

  /* ---- habits ---- */
  const habitLines = input.habits.map((h) => ({
    name: h.name,
    current: currentStreak(h.days, today),
    best: bestStreak(h.days),
  }));
  if (habitLines.length) {
    findings.push({
      key: "habits",
      label: "Habits",
      read: "Current run and best run for each.",
      facts: habitLines.map((h) => `${h.name}: ${h.current} now, best ${h.best}`),
      sample: `${habitLines.length} tracked`,
      sufficient: true,
    });
  }

  /* ---- the plan ----
   *
   * Sent without a switch, and marked insufficient on purpose. A task is a
   * boolean with no timestamp, so the app knows what is open but has never
   * recorded how long anything took or what a normal week looks like for this
   * user. The reading therefore says so in its own words, because a bare
   * "NOT ENOUGH DATA" is a label the model has to interpret and a sentence is
   * not. */
  const open = input.tasks.filter((t) => !t.done);
  const past = open.filter((t) => t.due !== null && t.due < today).length;
  const dueToday = open.filter((t) => t.due === today).length;
  const dueTomorrow = open.filter((t) => t.due === addDays(today, 1)).length;
  const someday = open.filter((t) => t.due === null).length;
  const later = open.length - past - dueToday - dueTomorrow - someday;
  const dated = open
    .filter((t) => t.due !== null)
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))
    .slice(0, TASK_TITLES);

  findings.push({
    key: "plan",
    label: "The plan",
    read:
      "What is on the plan right now. The app records whether a task is done but not when it was finished, so it cannot tell the user what is usual for them, and you must not imply that it can.",
    facts: [
      `${past} past due, ${dueToday} due today, ${dueTomorrow} due tomorrow, ${later} later, ${someday} with no date`,
      ...dated.map((t) => `${t.due}: ${t.title.slice(0, TASK_TITLE_CHARS)}`),
    ],
    sample: `${open.length} open of ${input.tasks.length}`,
    sufficient: false,
  });

  /* ---- money ---- */
  /* Whether this is a real ledger changes what the mentor may say about it, so it
     is stated in the finding itself rather than left to the prompt. A generated
     figure must never be reasoned about as though it were the user's money, and
     saying "placeholder" in the sample line is what stops that being a rule the
     model has to remember. */
  const moneyReal = input.moneyIsReal;
  findings.push({
    key: "money",
    label: moneyReal ? "Money this month" : "Money this month (placeholder figures)",
    read: `In ${money(input.money.incomeCents)}, out ${money(input.money.spentCents)}, net ${
      input.money.netCents < 0 ? "minus " : ""
    }${money(Math.abs(input.money.netCents))}.`,
    facts: [
      `top category ${input.money.byCategory[0]?.label ?? "none"} at ${money(
        input.money.byCategory[0]?.cents ?? 0,
      )}`,
      `${input.money.subscriptions.length} subscriptions, ${input.money.transactions.length} transactions`,
      moneyReal
        ? `balance ${money(input.money.balanceCents)}, from a linked bank account`
        : `NOT REAL — no bank linked, these numbers are generated`,
    ],
    sample: moneyReal
      ? `${input.money.transactions.length} transactions in ${input.money.month}`
      : `generated, not the user's money`,
    /* A real linked account is a real record and can be reasoned about. Generated
       figures are not: the mentor may describe what it sees but must not draw
       conclusions from it, which is what marking this insufficient does. */
    sufficient: moneyReal,
  });

  /* ---- notes ---- */
  const excerpts: NoteExcerpt[] = shareNotes
    ? input.notes.slice(0, NOTE_COUNT).map((e) => ({
        date: e.date,
        text: e.note.slice(0, NOTE_CHARS),
        tags: e.tags,
      }))
    : [];

  /* ---- events ----
   *
   * Entirely inside the switch. Off means the array is empty and the brief says
   * so, because "tell me you have no calendar" and "do not mention the calendar"
   * are different instructions to a model and only one of them is true. */
  const from = addDays(today, -EVENT_PAST_DAYS);
  const to = addDays(today, EVENT_FUTURE_DAYS);
  const calendar: CalendarLine[] = shareEvents
    ? input.events
        .filter((e) => e.date >= from && e.date <= to)
        .sort((a, b) => (a.date === b.date ? (a.startMin ?? 0) - (b.startMin ?? 0) : a.date < b.date ? -1 : 1))
        .slice(0, EVENT_COUNT)
        .map((e) => ({
          date: e.date,
          title: e.title,
          when: e.startMin === null ? "all day" : timeLabel(e.startMin),
          category: categoryLabel(e.category),
        }))
    : [];

  return {
    today,
    findings,
    notes: excerpts,
    notesShared: shareNotes,
    calendar,
    calendarShared: shareEvents,
  };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export const NOTES_INFO = { count: NOTE_COUNT, chars: NOTE_CHARS };

/** What the settings dialog tells the user it is about to share. */
export const EVENTS_INFO = {
  past: EVENT_PAST_DAYS,
  future: EVENT_FUTURE_DAYS,
  count: EVENT_COUNT,
};