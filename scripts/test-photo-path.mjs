/**
 * The progress-photo object name, and the reverse.
 *
 * Photos sync through the bucket rather than a table, so the object name is the
 * only place the date, the instant and the id live. Getting the encoding wrong
 * means a listings page that cannot tell one photo from another, or a date that
 * parses as part of the id — and the failure is silent, because a name that
 * decodes to null is simply skipped.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./scripts/ts-alias.mjs scripts/test-photo-path.mjs
 */
import { parsePhotoObjectName, photoObjectName } from "../src/lib/photo-path.ts";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const photo = { id: "6f1c2b40-aaaa-bbbb-cccc-1234567890ab", date: "2026-10-02", takenAt: 1790000000000 };
const name = photoObjectName(photo);

check("ends in .jpg", name.endsWith(".jpg"), name);
check("the name starts with the instant", name.startsWith(`${photo.takenAt}__`), name);

const back = parsePhotoObjectName(name, "user-123");
check("round-trips the id", back?.id === photo.id, back?.id);
check("round-trips the day", back?.date === photo.date, back?.date);
check("round-trips the instant", back?.takenAt === photo.takenAt);
check("builds the full path from the folder", back?.path === `user-123/${name}`, back?.path);

console.log("\nthe day's hyphens do not confuse the split");
/* The reason the separator is a double underscore: a single dash is everywhere in
   a YYYY-MM-DD date, so splitting on "-" would shred the day. */
check("a hyphenated day still parses", parsePhotoObjectName(name, "u")?.date === "2026-10-02");

console.log("\nanything that is not ours is rejected, not guessed at");
check("a non-jpg is ignored", parsePhotoObjectName("notes.txt", "u") === null);
check("too few parts is ignored", parsePhotoObjectName("2026-10-02__abc.jpg", "u") === null);
check("too many parts is ignored", parsePhotoObjectName("1__2026-10-02__a__b.jpg", "u") === null);
check("a bad day is ignored", parsePhotoObjectName("1__not-a-day__id.jpg", "u") === null);
check("a non-numeric instant is ignored", parsePhotoObjectName("soon__2026-10-02__id.jpg", "u") === null);
check("an empty id is ignored", parsePhotoObjectName("1__2026-10-02__.jpg", "u") === null);

console.log(`\n${failures === 0 ? "all passed" : `${failures} failed`}`);
if (failures !== 0) throw new Error(`${failures} failed`);
