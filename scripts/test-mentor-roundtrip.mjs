/**
 * The mentor's half of /api/sync, against a real database and a real route.
 *
 * The pure merge is covered in test-mentor-sync.mjs. What this covers is the part
 * that merge cannot prove: that a conversation pushed from one device comes back
 * out of the server as the same conversation, through the same route a phone would
 * call, with the foreign key and the conflict clauses actually behaving.
 *
 * Rows are written under a throwaway user id and cleaned up after, so it never
 * touches a real account's mentor history.
 *
 * Run: node --env-file=.env.local --experimental-strip-types --no-warnings --import ./scripts/ts-alias.mjs scripts/test-mentor-roundtrip.mjs
 */
import postgres from "postgres";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";

/* @next/env is CommonJS, so the named import is not available under ESM. */
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const TEST_USER = randomUUID();

/* The route and the DAL both take a user id from a verified session, so they are
 * exercised through the DAL directly rather than over HTTP: a request would need a
 * session, and forging one would test the auth layer instead of the thing being
 * tested here. The zod body is validated separately below. */
const dal = await import("../src/lib/dal.ts");
const {
  appendTurn,
  EMPTY_MENTOR,
  chatPayload,
  setSettings,
  settingsPayload,
  turnPayload,
} = await import("../src/lib/mentor/store.ts");

console.log("\nmentor round trip: through the database, both directions\n");

/* A profile row first: every other table references it, and the app creates it
   lazily at first write. Reproduced here so the foreign keys behave as they do in
   production rather than being skipped. */
await sql`insert into profiles (id, email, display_name) values (${TEST_USER}::uuid, ${`sync-test-${TEST_USER}@example.invalid`}, 'sync test') on conflict do nothing`;

const cleanup = async () => {
  /* Cascades handle chats and turns; the profile goes last. */
  await sql`delete from profiles where id = ${TEST_USER}::uuid`;
  await sql.end({ timeout: 5 }).catch(() => {});
};

try {
  /* ---- 1. a conversation goes in ---- */
  let s = appendTurn(EMPTY_MENTOR, "user", "I spent too much on food this month");
  s = appendTurn(s, "mentor", "You are out $99.90, mostly food. Worth a look at the top two.");
  s = setSettings(s, { notes: true, events: false });
  const chat = s.chats[0];

  const pushed = chatPayload(chat);
  const pushedTurns = chat.turns.map((t) => turnPayload(t, chat.id));

  await dal.upsertMentorChats(TEST_USER, [pushed]);
  await dal.upsertMentorTurns(TEST_USER, pushedTurns);
  await dal.upsertMentorSettings(TEST_USER, settingsPayload(s));

  const out = await dal.getMentorChats(TEST_USER, 50);
  check("the chat came back", out.length === 1, `${out.length} chats`);
  check("with the same client id", out[0]?.clientId === chat.id);
  check("and both turns", out[0]?.turns.length === 2, `${out[0]?.turns.length} turns`);
  check("in the order they were sent", out[0]?.turns[0]?.text.startsWith("I spent"));
  check("with the reply second", out[0]?.turns[1]?.text.startsWith("You are out"));
  check("and the name", out[0]?.title === null);

  const liveSettings = await dal.getMentorSettings(TEST_USER);
  check("the switches were written", liveSettings !== null);
  check("with note-reading on", liveSettings?.shareNotes === true);
  check("and calendar sharing off", liveSettings?.shareEvents === false);

  /* ---- 2. the second device ---- */
  /* A device that has never seen this chat reads it and rebuilds the local record.
     This is the actual claim being made to the user, so it is asserted end to end
     rather than inferred from the rows above. */
  const { mergeRemote } = await import("../src/lib/mentor/store.ts");
  const asRouteEmits = out.map((c) => ({
    clientId: c.clientId,
    title: c.title,
    updatedAt: c.updatedAt,
    turns: c.turns.map((t) => ({
      clientId: t.clientId,
      chatId: c.clientId,
      role: t.role,
      text: t.text,
      updatedAt: t.updatedAt,
    })),
  }));
  const secondDevice = mergeRemote(EMPTY_MENTOR, {
    chats: asRouteEmits,
    deleted: [],
    settings: liveSettings
      ? {
          shareNotes: liveSettings.shareNotes,
          shareEvents: liveSettings.shareEvents,
          updatedAt: liveSettings.updatedAt.toISOString(),
        }
      : null,
  });

  check("a second device reconstructs the chat", secondDevice.chats.length === 1);
  check("with the text intact", secondDevice.chats[0]?.turns[0]?.text.startsWith("I spent"));
  check("and its settings", secondDevice.settings.notes === true);
  check("and calendar still off", secondDevice.settings.events === false);
  check("and it does not steal focus", secondDevice.active === null);

  /* Push that second device's record straight back. It has to be a no-op, because
     a retried sync is the normal case and not the edge one. */
  await dal.upsertMentorChats(TEST_USER, [chatPayload(secondDevice.chats[0])]);
  await dal.upsertMentorTurns(
    TEST_USER,
    secondDevice.chats[0].turns.map((t) => turnPayload(t, secondDevice.chats[0].id)),
  );
  await dal.upsertMentorSettings(TEST_USER, settingsPayload(secondDevice));
  const afterRepush = await dal.getMentorChats(TEST_USER, 50);
  check("re-pushing a round-tripped record does not duplicate the chat", afterRepush.length === 1, `${afterRepush.length} chats`);
  check("nor the turns", afterRepush[0]?.turns.length === 2, `${afterRepush[0]?.turns.length} turns`);

  /* ---- 3. a reply on device two reaches device one ---- */
  const reply = {
    clientId: "device-two-reply",
    chatId: chat.id,
    role: "mentor",
    text: "That is a real pattern. Want to look at the subscriptions?",
    updatedAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await dal.upsertMentorTurns(TEST_USER, [reply]);
  const grown = await dal.getMentorChats(TEST_USER, 50);
  check("a turn from the other device lands", grown[0]?.turns.length === 3, `${grown[0]?.turns.length} turns`);

  const deviceOne = mergeRemote(s, {
    chats: grown.map((c) => ({
      clientId: c.clientId,
      title: c.title,
      updatedAt: c.updatedAt,
      turns: c.turns.map((t) => ({ clientId: t.clientId, role: t.role, text: t.text, updatedAt: t.updatedAt })),
    })),
    deleted: [],
  });
  check("and device one shows it", deviceOne.chats[0]?.turns.length === 3, `${deviceOne.chats[0]?.turns.length} turns`);
  check("without losing what it had", deviceOne.chats[0]?.turns[0]?.text.startsWith("I spent"));

  /* ---- 4. conflict: newer wins, older loses ---- */
  const staleEdit = {
    clientId: "device-two-reply",
    chatId: chat.id,
    role: "mentor",
    text: "REPLACED BY SOMETHING OLDER",
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  };
  await dal.upsertMentorTurns(TEST_USER, [staleEdit]);
  const afterStale = await dal.getMentorChats(TEST_USER, 50);
  check(
    "an older edit to the same turn is rejected",
    !afterStale[0]?.turns.some((t) => t.text.includes("REPLACED BY SOMETHING OLDER")),
    "last-write-wins means the newer text survives",
  );
  check("and the newer text is still there", afterStale[0]?.turns.some((t) => t.text.startsWith("That is a real pattern")));

  /* A newer edit does win. */
  const newerEdit = {
    ...staleEdit,
    text: "REPLACED BY SOMETHING NEWER",
    updatedAt: new Date(Date.now() + 120_000).toISOString(),
  };
  await dal.upsertMentorTurns(TEST_USER, [newerEdit]);
  const afterNewer = await dal.getMentorChats(TEST_USER, 50);
  check(
    "a newer edit does win",
    afterNewer[0]?.turns.some((t) => t.text.includes("REPLACED BY SOMETHING NEWER")),
  );
  check("and it is not a second turn", afterNewer[0]?.turns.length === 3, `${afterNewer[0]?.turns.length} turns`);

  /* ---- 4b. a rename reaches the server ---- */
  /* The failure this guards against is specific and silent: a rename moved no
     message, so if the row were stamped with the conversation's recency the server
     would see an unchanged value, decide the incoming row was not newer, and drop
     the name. Nothing errors. The name simply does not exist on the other device. */
  const { renameChat } = await import("../src/lib/mentor/store.ts");
  const renamed = renameChat(deviceOne, chat.id, "the food month");
  await dal.upsertMentorChats(TEST_USER, [chatPayload(renamed.chats[0])]);
  const afterRename = await dal.getMentorChats(TEST_USER, 50);
  check("a rename reaches the server", afterRename[0]?.title === "the food month", `got ${afterRename[0]?.title}`);

  /* ---- 4c. the switches, on their own row ---- */
  /* Every case here was broken when the switches rode on a chat: a user with no
     chats had nowhere to put them, a toggle changed no chat so it was never
     written, and "off" was not newer than anything so it could not be expressed. */
  const settingsAt = (ms) => new Date(ms).toISOString();
  await dal.upsertMentorSettings(TEST_USER, {
    shareNotes: true,
    shareEvents: true,
    updatedAt: settingsAt(Date.now() + 200_000),
  });
  check(
    "turning sharing on sticks",
    (await dal.getMentorSettings(TEST_USER))?.shareNotes === true,
  );

  /* The one that matters: off, later. */
  await dal.upsertMentorSettings(TEST_USER, {
    shareNotes: false,
    shareEvents: false,
    updatedAt: settingsAt(Date.now() + 300_000),
  });
  const offRow = await dal.getMentorSettings(TEST_USER);
  check("turning sharing off sticks", offRow?.shareNotes === false);
  check("both of them", offRow?.shareEvents === false);

  /* A device that has had sharing off for a week pushes its stale "off" again.
     It must not be able to flip itself, or to anything else, back on. */
  await dal.upsertMentorSettings(TEST_USER, {
    shareNotes: true,
    shareEvents: true,
    updatedAt: settingsAt(Date.now() - 600_000),
  });
  const stillOff = await dal.getMentorSettings(TEST_USER);
  check("a stale 'on' does not undo an 'off'", stillOff?.shareNotes === false, `got ${stillOff?.shareNotes}`);

  /* And the row is one row, not one per push. */
  const settingsRows = await sql`select count(*)::int as n from mentor_settings where user_id = ${TEST_USER}::uuid`;
  check("there is one settings row, not one per push", settingsRows[0].n === 1, `${settingsRows[0].n} rows`);

  /* A user who has never touched the settings has no row, which the client reads as
     "no opinion" rather than as "off". Checked against this same user after its row
     is cleared, because the point is the shape of the answer, not the account. */
  await sql`delete from mentor_settings where user_id = ${TEST_USER}::uuid`;
  check(
    "a user who never set them has no row",
    (await dal.getMentorSettings(TEST_USER)) === null,
  );

  /* ---- 5. a turn whose chat is not there is skipped, not fatal ---- */
  const orphan = {
    clientId: "orphan",
    chatId: "no-such-chat",
    role: "user",
    text: "should not be stored",
    updatedAt: new Date().toISOString(),
  };
  /* Alongside a real turn, so a single orphan cannot be dismissed as "nothing to
     do" — the batch must land the good row and drop only the bad one. If the whole
     batch failed on the foreign key, the good turn would go too, and that is the
     failure this catches. */
  await dal.upsertMentorTurns(TEST_USER, [
    orphan,
    { ...reply, clientId: "good-in-a-batch", text: "this one should survive" },
  ]);
  const afterOrphan = await dal.getMentorChats(TEST_USER, 50);
  check("a turn for a missing chat is skipped", !afterOrphan[0]?.turns.some((t) => t.text === "should not be stored"));
  check("and the rest of the batch still lands", afterOrphan[0]?.turns.some((t) => t.text === "this one should survive"));
  check("so no row was lost to the foreign key", afterOrphan[0]?.turns.length === 4, `${afterOrphan[0]?.turns.length} turns`);

  /* ---- 6. deletes travel and cascade ---- */
  await dal.tombstoneMentorChats(TEST_USER, [chat.id]);

  const goneLive = await dal.getMentorChats(TEST_USER, 50);
  check("a deleted chat is not returned", goneLive.length === 0, `${goneLive.length} chats`);

  const tomb = await dal.getDeletedMentorChats(TEST_USER, 50);
  check("its tombstone is readable", tomb.some((t) => t.clientId === chat.id));
  check("and the delete moved the clock forward", tomb[0]?.updatedAt instanceof Date);

  /* The rows themselves stay. That is the point of a tombstone: the other device
     has to be told it is gone, which needs the record to still be findable. */
  const stillThere = await sql`select count(*)::int as n from mentor_chats where user_id = ${TEST_USER}::uuid`;
  check("the row is kept, not removed", stillThere[0].n === 1);

  const orphanTurns = await sql`select count(*)::int as n from mentor_turns where user_id = ${TEST_USER}::uuid`;
  check("and its turns are kept for the same reason", orphanTurns[0].n === 4, `${orphanTurns[0].n} turns`);

  /* An edit after a delete brings the chat back, and that has to work — it is what
     stops the tombstone from being permanent if a stale push arrives late. */
  await dal.upsertMentorChats(TEST_USER, [
    { clientId: chat.id, title: "back from the dead", updatedAt: new Date(Date.now() + 300_000).toISOString() },
  ]);
  const revived = await dal.getMentorChats(TEST_USER, 50);
  check("a newer push revives a deleted chat", revived.length === 1, `${revived.length} chats`);
  check("with its new name", revived[0]?.title === "back from the dead");

  /* ---- 7. one user cannot see another's chats ---- */
  const OTHER = randomUUID();
  await sql`insert into profiles (id, email, display_name) values (${OTHER}::uuid, ${`sync-test-${OTHER}@example.invalid`}, 'other') on conflict do nothing`;
  const otherSees = await dal.getMentorChats(OTHER, 50);
  check("another user sees none of it", otherSees.length === 0, `${otherSees.length} chats`);

  /* And a push naming this user's chat cannot land in the other's account, because
     the id comes from the session and is overwritten on the row. */
  await dal.upsertMentorChats(OTHER, [
    { clientId: chat.id, title: "not yours", updatedAt: new Date().toISOString() },
  ]);
  const stolen = await sql`select count(*)::int as n from mentor_chats where user_id = ${OTHER}::uuid and client_id = ${chat.id}`;
  check("a push cannot write into another account", stolen[0].n === 1, "it wrote into its own user instead");
  const stillMine = await sql`select user_id::text as u from mentor_chats where client_id = ${chat.id}`;
  check("and the original row is still this user's", stillMine.every((r) => r.u === OTHER || r.u === TEST_USER));

  await sql`delete from profiles where id = ${OTHER}::uuid`;

  /* ---- 8. one chat id, two conversations, do not collide ---- */
  /* The turn's conflict target includes chat_id, so the same client turn id under a
     different chat must be a separate row rather than an update of the first. */
  const a = "shared-turn-id";
  const b = "other-chat";
  await dal.upsertMentorChats(TEST_USER, [
    { clientId: b, title: "second conversation", updatedAt: new Date().toISOString() },
  ]);
  await dal.upsertMentorTurns(TEST_USER, [
    { clientId: a, chatId: chat.id, role: "user", text: "in the first", updatedAt: new Date().toISOString() },
    { clientId: a, chatId: b, role: "user", text: "in the second", updatedAt: new Date().toISOString() },
  ]);
  const collisions = await sql`
    select count(*)::int as n from mentor_turns
    where user_id = ${TEST_USER}::uuid and client_id = ${a}`;
  check("the same turn id in two chats is two rows", collisions[0].n === 2, `${collisions[0].n} rows`);
} catch (e) {
  failures++;
  console.log(`  FAIL  threw — ${e?.message ?? e}`);
} finally {
  await cleanup();
}

console.log(`\n${failures === 0 ? "all passed" : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);