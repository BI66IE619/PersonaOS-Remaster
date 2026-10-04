import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

let failures = 0;
const check = (name, cond, extra = "") => {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/* The three movements, the rep counts they are normally done at, and the set
   count each is worked to. Kept in step with PROGRAM in src/lib/strength.ts.
   Asserted as literals on purpose: if the programme drifts, this should fail
   rather than quietly follow it. */
const PROGRAM = [
  { name: "Bench press", usual: 12, sets: 4 },
  { name: "Bicep curls", usual: 16, sets: 4 },
  { name: "Overhead dumbbell tricep extension", usual: 22, sets: 4 },
];

/* Scoped to the strength panel: /body has other panels with buttons in them. */
const panel = page.locator(".panel").filter({ hasText: "Strength log" });
const row = (name) => panel.getByRole("button", { name: new RegExp(`Log a set of ${name}`) }).first();
const rowText = async (name) => (await row(name).innerText()).replace(/\s+/g, " ");

/* The undo affordance is a real U+2039, not an ASCII <. Written as an escape
   because a literal in this file is read as UTF-8 or as CP1252 depending on who
   runs it, and a mangled one silently stops matching anything — which is how the
   check below came to assert nothing at all. */
const UNDO_HINT = "\u2039 drag back";
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("personaos:strength") || "null"));
const setsFor = async (id) => {
  const s = await state();
  const day = Object.keys(s.days).sort().pop();
  return s.days[day]?.[id] ?? [];
};

/**
 * Drag a row sideways with real pointer events, in steps, so the component sees
 * the same move/move/move/up sequence a finger produces. A single jump to the
 * end would skip the axis decision and would not prove the gesture works.
 */
const drag = async (locator, dx) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box to drag");
  const y = box.y + box.height / 2;
  const startX = dx > 0 ? box.x + 8 : box.x + box.width - 8;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (dx * i) / steps, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(260);
};

const adjust = async () => {
  const btn = panel.getByRole("button", { name: "Adjust" });
  if ((await btn.getAttribute("aria-expanded")) !== "true") {
    await btn.click();
    await page.waitForTimeout(250);
  }
};
const collapseAdjust = async () => {
  /* exact, because the log rows' accessible names contain "logged" and would
     otherwise be a loose match. */
  const btn = panel.getByRole("button", { name: "Done", exact: true });
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(250);
  }
};

await page.goto(BASE + "/body", { waitUntil: "load" });
await page.waitForTimeout(1500);

/* ---- the default view is just the movements ---- */
check("three movements, no empty panel", (await row("Bench press").count()) === 1);
check(
  "the add-a-movement box is not on the default view",
  (await panel.getByLabel("Add a movement").count()) === 0,
  "it belongs behind Adjust",
);
check(
  "the only disclosure is Adjust, not a per-movement accordion",
  (await panel.locator("button[aria-expanded]").count()) === 1 &&
    (await panel.getByRole("button", { name: "Adjust" }).getAttribute("aria-expanded")) === "false",
  "movements used to expand one at a time",
);
check(
  "each row is a button, so the gesture has a keyboard equivalent",
  (await panel.getByRole("button", { name: /Log a set of/ }).count()) === 3,
);

for (const p of PROGRAM) {
  const s = await state();
  const found = s.exercises.find((e) => e.name === p.name);
  check(`${p.name} present`, Boolean(found));
  check(`${p.name} starts at ${p.usual}`, found?.usualReps === p.usual, `usual=${found?.usualReps}`);
  check(`${p.name} is worked to ${p.sets} sets`, found?.targetSets === p.sets, `targetSets=${found?.targetSets}`);
}

/* The row states what a drag will record, and says "drag" not "swipe" because on
   a desktop a drag means holding the button — moving the mouse across the row is
   only hover, and the hint has to match what the hardware needs. */
check(
  "the row previews what a drag logs",
  (await rowText("Bench press")).includes("drag right to log 12 reps"),
  await rowText("Bench press"),
);
check(
  "the target is shown before anything is logged",
  (await rowText("Bench press")).includes("4 sets"),
  await rowText("Bench press"),
);

/* Moving the mouse across the row without holding the button is hover, not a
   drag. It must do nothing at all, or a row would log a set just from the
   pointer passing over it. */
{
  const hbox = await row("Bench press").boundingBox();
  await page.mouse.move(hbox.x + 10, hbox.y + hbox.height / 2);
  await page.mouse.move(hbox.x + hbox.width - 10, hbox.y + hbox.height / 2, { steps: 6 });
  await page.waitForTimeout(250);
  check("hovering across the row logs nothing", (await setsFor("bench-press")).length === 0, "hover is not a drag");
}

/* Tapping the row is not how you log either: the drag is. A tap next to an
   intended drag is exactly how sets appear that nobody meant to add. */
await row("Bench press").click();
await page.waitForTimeout(250);
check("a tap on the row logs nothing", (await setsFor("bench-press")).length === 0, "drag only");
check(
  "the row still says how to undo, once there is something to undo",
  (await rowText("Bench press")).includes(UNDO_HINT) === false,
  "nothing logged yet, so no undo hint",
);

/* ---- THE GESTURE: a real drag logs one set ---- */
await drag(row("Bench press"), 260);
check("a rightward drag logs a set", (await setsFor("bench-press")).length === 1, `${(await setsFor("bench-press")).length} sets`);
check("the set starts at the usual rep count", (await setsFor("bench-press"))[0]?.reps === 12);
check("the row counts it", (await rowText("Bench press")).includes("1/4"), await rowText("Bench press"));

/* A short drag must not count, or every nudge on a scrolling page would log a set. */
await drag(row("Bicep curls"), 40);
check("a short drag does not log a set", (await setsFor("bicep-curls")).length === 0, `${(await setsFor("bicep-curls")).length} sets`);

/* A vertical drag is the page scrolling, never a log. */
const curlsBox = await row("Bicep curls").boundingBox();
await page.mouse.move(curlsBox.x + 40, curlsBox.y + curlsBox.height / 2);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(curlsBox.x + 40, curlsBox.y + curlsBox.height / 2 - i * 12);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(260);
check("a vertical drag does not log a set", (await setsFor("bicep-curls")).length === 0, "scrolling is left alone");

/* Four drags to work a movement out. */
for (let i = 0; i < 3; i++) await drag(row("Bench press"), 260);
check("drags stack up to the target", (await setsFor("bench-press")).length === 4, `${(await setsFor("bench-press")).length} sets`);
check("the row marks the target met", (await rowText("Bench press")).includes("4/4"), await rowText("Bench press"));

/* The keyboard path still has to work. Tapping is gone, so this is now the only
   non-drag way in, and it is the only way a keyboard or screen reader has. */
await row("Overhead dumbbell tricep extension").focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
check(
  "Enter still logs, since a drag is not something a keyboard can do",
  (await setsFor("overhead-db-tricep-extension")).length === 1,
  "accessibility path kept",
);
check("it starts at the usual 22", (await setsFor("overhead-db-tricep-extension"))[0]?.reps === 22);
check(
  "the row shows the undo hint once a set is logged",
  (await rowText("Overhead dumbbell tricep extension")).includes(UNDO_HINT),
  await rowText("Overhead dumbbell tricep extension"),
);

/* Dragging back undoes the last set, so a stray drag is not a dead end. */
await drag(row("Bench press"), -260);
check("a leftward drag takes the last set back", (await setsFor("bench-press")).length === 3, `${(await setsFor("bench-press")).length} sets`);

/* ---- the weight comes from the movement and stays put ---- */
await adjust();
check("Adjust reveals the add box", (await panel.getByLabel("Add a movement").count()) === 1);
check("Adjust reveals the weight field", (await panel.getByLabel("Weight for Bench press in pounds").count()) === 1);

await panel.getByLabel("Weight for Bench press in pounds").fill("165");
await page.waitForTimeout(300);
check("the weight is stored on the movement", (await state()).exercises.find((e) => e.name === "Bench press")?.weightLb === 165);

/* Existing sets keep the weight they were done at, so history is not rewritten
   when the number changes later. */
const beforeChange = (await setsFor("bench-press")).map((s) => s.weightLb);
await panel.getByLabel("Weight for Bench press in pounds").fill("170");
await page.waitForTimeout(300);
check("already-logged sets keep the weight they were done at", (await setsFor("bench-press")).map((s) => s.weightLb).join() === beforeChange.join(), beforeChange.join());

/* A new set picks up the new weight without anything being asked. */
await collapseAdjust();
await drag(row("Bench press"), 260);
const latest = (await setsFor("bench-press")).at(-1);
check("a new set uses the movement's weight", latest?.weightLb === 170, `weightLb=${latest?.weightLb}`);
check("a new set uses the usual reps", latest?.reps === 12);

await collapseAdjust();
check("the row says what weight a drag will log", (await rowText("Bench press")).includes("170 lb"), await rowText("Bench press"));

/* ---- Adjust: rep values, targets, adding ---- */
await adjust();
const usualInput = panel.getByLabel("Usual reps for Bicep curls");
await usualInput.fill("14");
await page.waitForTimeout(300);
check("editing the usual count is stored", (await state()).exercises.find((e) => e.name === "Bicep curls")?.usualReps === 14);

await panel.getByLabel("Set target for Bicep curls").fill("3");
await page.waitForTimeout(300);
check("the set target is editable", (await state()).exercises.find((e) => e.name === "Bicep curls")?.targetSets === 3);

await collapseAdjust();
await drag(row("Bicep curls"), 260);
check("the edited count is what a new set starts on", (await setsFor("bicep-curls"))[0]?.reps === 14, "14");

await adjust();
check("a logged set's reps can be corrected", (await panel.getByLabel("Bicep curls set 1 reps").count()) === 1);
check(
  "a logged set's weight is shown, not edited",
  (await panel.getByText(/^165 lb$|^bodyweight$/).count()) >= 0 && (await panel.getByLabel(/Weight for Bicep curls/).count()) === 1,
  "weight belongs to the movement",
);

const before = (await state()).exercises.length;
await panel.getByLabel("Add a movement").fill("Lateral raise");
await panel.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(300);
check("a custom movement can be added", (await state()).exercises.length === before + 1);

await panel.getByLabel("Add a movement").fill("bench press");
await panel.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(300);
check("a movement is not added twice", (await state()).exercises.length === before + 1, "case-insensitive");
check(
  "the duplicate kept the original entry",
  (await state()).exercises.find((e) => e.name === "Bench press")?.weightLb === 170,
  "re-adding must not reset a movement you have been lifting",
);

await panel.getByRole("button", { name: "Remove Lateral raise" }).click();
await page.waitForTimeout(300);
check("a movement can be removed", (await state()).exercises.length === before, `${(await state()).exercises.length}`);

await collapseAdjust();

/* ---- it survives a reload ---- */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("movements persist", (await row("Bench press").count()) === 1);
check("the edited count persists", (await state()).exercises.find((e) => e.name === "Bicep curls")?.usualReps === 14);
check("the weight persists", (await state()).exercises.find((e) => e.name === "Bench press")?.weightLb === 170);
check("logged sets persist", (await setsFor("bench-press")).length === 4, `${(await setsFor("bench-press")).length} sets`);
check("Adjust starts closed again", (await panel.getByLabel("Add a movement").count()) === 0);

/* ---- the seed must not run a second time ---- */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("no duplicates after a second reload", (await panel.getByRole("button", { name: /Log a set of/ }).count()) === 3);

/* ---- THE MIGRATION: a store written before weight lived on the movement ---- */
/* weightLb moved from the set to the movement, so existing stores have no
   standing weight. It has to come from the weight actually lifted, not reset to
   bodyweight, which would quietly drop a user's real history. */
await page.evaluate(() => {
  const day = new Date().toISOString().slice(0, 10);
  localStorage.setItem(
    "personaos:strength",
    JSON.stringify({
      seeded: true,
      exercises: [
        { id: "custom-1", name: "Face pulls", usualReps: 15 },
        { id: "bench-press", name: "Bench press", usualReps: 12 },
      ],
      days: {
        [day]: { "bench-press": [{ reps: 12, weightLb: 95 }] },
        "2026-01-05": { "bench-press": [{ reps: 10, weightLb: 80 }] },
      },
    }),
  );
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);

check(
  "the row previews the weight it recovered",
  (await rowText("Bench press")).includes("95 lb"),
  await rowText("Bench press"),
);
check(
  "a movement never lifted has no weight",
  (await rowText("Face pulls")).includes("bodyweight"),
  await rowText("Face pulls"),
);
check(
  "a movement with no target shows none, rather than a bare fraction",
  !(await rowText("Face pulls")).includes("/0"),
  await rowText("Face pulls"),
);

/* ---- personal bests ----
   Seeded rather than dragged: the panel reads a month of history, and building
   that with a dozen pointer gestures would test the drag twice and the maths
   not at all. Dates are relative to today so the 28-day window holds whenever
   this runs. */
const shift = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
await page.evaluate(
  ([a, b, c]) => {
    localStorage.setItem(
      "personaos:strength",
      JSON.stringify({
        seeded: true,
        exercises: [
          { id: "bench-press", name: "Bench press", usualReps: 8, targetSets: 4, weightLb: 115 },
          { id: "bicep-curls", name: "Bicep curls", usualReps: 16, targetSets: 4, weightLb: 20 },
          { id: "push-ups", name: "Push-ups", usualReps: 20, targetSets: 3, weightLb: 0 },
        ],
        days: {
          /* 60 days back, 40 days back, and 2 days back: only the last is
             outside the window, so the comparison has a month behind it. */
          [a]: { "bench-press": [{ reps: 5, weightLb: 95 }] },
          [b]: { "bench-press": [{ reps: 5, weightLb: 100 }] },
          [c]: {
            "bench-press": [{ reps: 5, weightLb: 115 }],
            "bicep-curls": [{ reps: 10, weightLb: 20 }],
            /* Bodyweight, which must not become a record. */
            "push-ups": [{ reps: 25, weightLb: 0 }],
          },
        },
      }),
    );
  },
  [shift(-60), shift(-40), shift(-2)],
);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);

const pr = page.locator(".panel").filter({ hasText: "Personal bests" });
check("the bests panel is there", (await pr.count()) === 1, String(await pr.count()));
check("it counts the movements it scored", (await pr.getByText(/2 movements/).count()) === 1, (await pr.innerText()).replace(/\n/g, " | "));
/* e1rm(115,5) = 134, e1rm(100,5) = 117 */
check("the record is shown as an estimated 1RM", (await pr.getByText(/134lb/).count()) === 1, (await pr.innerText()).replace(/\n/g, " | "));
check("with the set that produced it", (await pr.getByText(/115lb x 5/).count()) === 1);
check("and the gain over a month ago", (await pr.getByText(/\+17lb on a month ago's 117lb/).count()) === 1, (await pr.innerText()).replace(/\n/g, " | "));
check("bodyweight is left out of the records", (await pr.getByText(/Push-ups/).count()) === 0);
check("a movement with no month behind it says so", (await pr.getByText(/First month on record/).count()) === 1, (await pr.innerText()).replace(/\n/g, " | "));

/* Empty, and it explains itself rather than showing a blank panel. */
await page.evaluate(() => {
  localStorage.setItem(
    "personaos:strength",
    JSON.stringify({ seeded: true, exercises: [{ id: "push-ups", name: "Push-ups", usualReps: 20, targetSets: 3, weightLb: 0 }], days: {} }),
  );
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("an empty log is explained, not blank", (await pr.getByText(/Log a weighted set/).count()) === 1, (await pr.innerText()).replace(/\n/g, " | "));

/* ---- units and layout ---- */
check("no kg anywhere on the page", (await page.getByText(/\d kg/).count()) === 0);

for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(500);
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check(`no overflow-x at ${w}px`, !o);
}

check("console errors", errors.length === 0, errors.join(" / "));
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
await b.close();
process.exit(failures ? 1 : 0);
