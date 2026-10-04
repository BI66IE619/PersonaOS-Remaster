"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { buildBrief, EVENTS_INFO, NOTES_INFO } from "@/lib/mentor/brief";
import { buildContext } from "@/lib/mentor/prompt";
import { parseInline } from "@/lib/mentor/inline";
import { CRISIS_LINE } from "@/lib/mentor/crisis";
import type { MentorChat } from "@/lib/mentor/types";
import { whenLabel } from "@/lib/mentor/when";
import { chatLabel, chatLabelShort } from "@/lib/mentor/chat-label";
import {
  MAX_TITLE,
  addTurn,
  deleteChat,
  getServerSnapshot as getMentorServer,
  getSnapshot as getMentor,
  newChat,
  openChat,
  setChatTitle,
  setEventSharing,
  setNoteReading,
  subscribe as mentorSubscribe,
} from "@/lib/mentor/store";
import { applyRemote, claimMentorOwnership } from "@/lib/mentor/store";
import { scheduleMentorSync } from "@/lib/mentor/sync";
import type { MentorSettingsPayload } from "@/lib/mentor/types";
import type { MoneyView } from "@/lib/finance/types";
import {
  getServerSnapshot as getTasksServer,
  getSnapshot as getTasks,
  subscribe as tasksSubscribe,
} from "@/lib/tasks";
import {
  getServerSnapshot as getHabitsServer,
  getSnapshot as getHabits,
  subscribe as habitsSubscribe,
} from "@/lib/habits";
import {
  getServerSnapshot as getCheckInsServer,
  getSnapshot as getCheckIns,
  subscribe as checkInsSubscribe,
} from "@/lib/checkins";
import {
  getServerSnapshot as getNotesServer,
  getSnapshot as getNotes,
  subscribe as notesSubscribe,
} from "@/lib/notes";
import {
  getServerSnapshot as getWeightsServer,
  getSnapshot as getWeights,
  logsOf,
  subscribe as weightsSubscribe,
} from "@/lib/weight-log";
import {
  getServerSnapshot as getSportsServer,
  getSnapshot as getSports,
  subscribe as sportsSubscribe,
} from "@/lib/sports";
import {
  getServerSnapshot as getStrengthServer,
  getSnapshot as getStrength,
  subscribe as strengthSubscribe,
} from "@/lib/strength";
import { solid } from "@/lib/theme";import type { TodayView } from "@/lib/types";

export function MentorScreen({
  view,
  opening,
  money,
  moneyIsReal,
  initialChats = null,
  initialSettings = null,
  userId,
}: {
  view: TodayView;
  opening: string;
  money: MoneyView;
  moneyIsReal: boolean;
  /** Chats read from the server, or null when the read failed. Used to seed the
   *  local record before first paint so the recents log is not empty for a beat. */
  initialChats?: unknown[] | null;
  /** Sharing switches read from the server, with the clock they were written at.
   *  Same rule as the chats: null when nothing was ever written, which the merge
   *  reads as "no opinion" rather than as "off". */
  initialSettings?: MentorSettingsPayload | null;
  /** The account the server has verified this session belongs to. The chats on
   *  this device are bound to it, so a sign-out and a sign-in as somebody else
   *  does not leave the previous account's conversations on screen. */
  userId: string;
}) {
  const today = view.date;

  const mentor = useSyncExternalStore(mentorSubscribe, getMentor, getMentorServer);
  const habits = useSyncExternalStore(habitsSubscribe, getHabits, getHabitsServer);
  const checkIns = useSyncExternalStore(checkInsSubscribe, getCheckIns, getCheckInsServer);
  const notes = useSyncExternalStore(notesSubscribe, getNotes, getNotesServer);
  const weights = logsOf(useSyncExternalStore(weightsSubscribe, getWeights, getWeightsServer));
  const sports = useSyncExternalStore(sportsSubscribe, getSports, getSportsServer);
  const strength = useSyncExternalStore(strengthSubscribe, getStrength, getStrengthServer);
  const plan = useSyncExternalStore(tasksSubscribe, getTasks, getTasksServer);

  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  /* Which chat a delete is pending for, or null when nothing is pending. The
     whole chat is held rather than its id so the dialog can name it and count
     its messages without reaching back into a list that may have changed. */
  const [deleting, setDeleting] = useState<MentorChat | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const brief = useMemo(() => {
    /* Money arrives as a prop from the server, which is where the real figures
       are read from. It used to be generated here from the seed, which meant the
       mentor discussed a fictional ledger: it reported $1,563 spent in September
       beside a real account that spent $99.90. Nothing failed, because the
       placeholder path worked exactly as designed — it just stopped being the
       truth once a bank was linked. */
    return buildBrief({
      today,
      view,
      habits: habits.habits,
      strength,
      checkIns: checkIns.entries,
      notes: notes.entries,
      weightLogs: weights,
      sports: sports.sessions,
      money,
      moneyIsReal,
      /* Tasks go with the brief whether or not anything is switched on: they are
         the user's own words about their own week. Events do not, and the
         switch is read here rather than anywhere downstream, so that there is
         exactly one line in the codebase that can put an event on the wire. */
      tasks: plan.tasks,
      events: plan.events,
      shareNotes: mentor.settings.notes,
      shareEvents: mentor.settings.events,
    });
  }, [today, view, habits.habits, strength, checkIns.entries, notes.entries, weights, sports.sessions, money, moneyIsReal, plan.tasks, plan.events, mentor.settings.notes, mentor.settings.events]);

  /* The brief rendered to the string that goes on the wire. Built once here so the settings
     viewer shows the identical text the send path posts, rather than a second call that could
     disagree with the first if the builder ever became time-dependent. */
  const context = useMemo(() => buildContext(brief), [brief]);

  /* The chat in front of you is whatever the store says is active, or nothing
     if you are sitting on the fresh screen. "New chat" is not a delete: the
     conversation stays saved and is one tap from the recents log. */
  const chat = mentor.chats.find((c) => c.id === mentor.active) ?? null;
  const turns = chat?.turns ?? [];

  const recents = useMemo(
    () => [...mentor.chats].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    [mentor.chats],
  );
  /* An empty chat and a chat with something in it are two different layouts,
     not two different screens: the opening and the prompt box belong together in
     the middle when there is nothing to read, and the prompt box belongs at the
     bottom once there is. `thinking` counts as empty, so a first question that
     has been sent but not yet answered does not yank the box up mid-send. */
  const reduced = useReducedMotion();
  const empty = turns.length === 0 && !thinking;

  /* Follow the conversation as it grows. A chat that does not scroll itself is
     the thing that makes a chat feel broken, and the panel it scrolls inside is
     the only one on the tab. The chat's id is in the deps too: reopening a
     saved chat must land on its newest message even when the new chat had just
     as many turns as the old one. `turns` itself is left out because its
     identity is not stable while it is the fresh chat's empty array. */
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.id, turns.length, thinking]);

  /* Whose record this is, before anything is read out of it or written into it.
   *
   * Runs during the first render rather than in an effect, because an effect runs
   * after the paint: the recents log would render one frame with the previous
   * account's conversations on screen, which is the whole leak this prevents. The
   * store is a module singleton, so claiming during render is a write during
   * render — safe here only because the claim is idempotent and the read that
   * follows it is the same snapshot every consumer gets. */
  if (mentor.owner !== userId) claimMentorOwnership(userId);

  /* Seed from the server, once.
   *
   * The props arrive with the HTML so a second device does not paint an empty
   * recents log and then fill it in. Seeded into the same store rather than kept
   * beside it, so there is one copy of a chat rather than a server one and a local
   * one that agree only until the next write.
   *
   * `seeded` records that seeding was *attempted*, not that it found anything.
   * Gating the sync below on "the seed found rows" means a device whose server read
   * failed — the exact device that most needs to push its local conversations
   * somewhere safe — would never sync at all, and would keep its history in
   * localStorage until the tab was closed and lost. */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (!initialChats) return;
    /* One merge, so the switches and the conversations they govern arrive together
       and the record is written once. Applying them separately would leave a moment
       where the chat list has another device's conversations and the switches are
       still the defaults — a moment in which the settings panel reads "off" while
       the local record says on, and a message sent in it goes out with the wrong
       brief. */
    applyRemote({ chats: initialChats, deleted: [], settings: initialSettings });
  }, [initialChats, initialSettings]);

  /* Push whatever changed, and on the first render whether anything did.
   *
   * Covers every write path — a sent message, a reply, a rename, a delete, either
   * sharing switch — because they all go through the store, and watching the record
   * rather than each call site means a new kind of write cannot forget to sync. The
   * debounce inside collapses a message-and-reply pair into one request.
   *
   * The effect has no dependency on `mentor` on purpose for the first run: a device
   * whose local record is already correct has nothing to push and would otherwise
   * never contact the server, so it would never learn about a conversation started
   * on the other device until the user typed something here. */
  useEffect(() => {
    if (!seeded.current) return;
    scheduleMentorSync();
  }, [mentor]);

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || thinking) return;

    setDraft("");
    setProblem(null);
    addTurn("user", message);
    setThinking(true);
    if (box.current) box.current.style.height = "auto";

    try {
      const res = await fetch("/api/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: context,
          message,
          /* Only what a model can be shown as a model turn. Ids and timestamps
             are ours and mean nothing there. */
          turns: turns.map((t) => ({ role: t.role === "mentor" ? "assistant" : "user", text: t.text })),
        }),
      });

      const data = (await res.json()) as { text?: string; crisis?: boolean; error?: string };

      if (data.crisis) {
        addTurn("mentor", CRISIS_LINE);
      } else if (!res.ok) {
        setProblem(data.error ?? "Something went wrong.");
      } else {
        addTurn("mentor", data.text ?? "");
      }
    } catch {
      setProblem("The mentor could not be reached.");
    } finally {
      setThinking(false);
    }
  };

  return (
    <PageShell fill>
      {/* Fills the shell rather than asking for a height in dvh. See PageShell:
          the chrome above and below this box is not one number on every
          breakpoint, and subtracting a guess from 100dvh is what left the page
          scrollable by a few pixels. min-h-0 is what lets the scroller actually
          scroll — a flex child defaults to refusing to shrink below its content,
          so without it the messages would push the composer off the bottom
          instead of scrolling. */}
      <div data-mentor-body className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 py-3">
          {/* The corner is the tab's name, as it is on every other screen. The
              mentor's own name is not there: a name in a corner is a label on a
              tab, and a name above a greeting is someone introducing themselves. */}
          <h1 className="text-sm font-medium">Mentor</h1>
          <div className="flex items-center gap-1">
            {/* Only meaningful out of a conversation: it steps back to the
              fresh screen, and the saved chats hold the line from there. Out of
              a chat — or mid-thought — it is disabled, because letting a reply
              land in a box with no chat to put it in is how a stray conversation
              of one bubble appears in the log. */}
            <button
              type="button"
              onClick={newChat}
              disabled={turns.length === 0 || thinking}
              aria-label="New chat"
              title="New chat"
              className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2 disabled:opacity-35"
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              aria-label="Mentor settings"
              className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
            >
              <Settings size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </header>

      <motion.div
        data-mentor-stage
        layout={!reduced}
        transition={reduced ? undefined : { type: "spring", stiffness: 420, damping: 38 }}
        className={
          empty
            ? "flex min-h-0 flex-1 flex-col items-center justify-center gap-6"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        <div
          ref={scroller}
          data-mentor-scroll
          className={
            empty
              ? "flex w-full shrink-0 items-center justify-center"
              : "min-h-0 flex-1 overflow-y-auto"
          }
        >
          {turns.length === 0 && !thinking ? (
            /* Sized off the conversation rather than the panel: it is the one
               thing on an empty chat, and at panel size it read as a caption for
               something that was meant to be an opening line. It is centred as
               part of a group with the prompt box below it, not on its own.
               The name goes above the line rather than beside it, quietly: it is
               who is talking, the line underneath is what they are saying, and
               the two together read as an introduction instead of a label. */
            <div className="flex flex-col items-center gap-2">
              <p data-mentor-intro className="text-sm text-ink-3">
                Hi, I&rsquo;m Wren.
              </p>
              <p
                data-mentor-opening
                className="max-w-[19rem] text-center text-lg leading-relaxed text-ink-2"
              >
                {opening}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-4 py-2">
              {turns.map((t) => (
                <li
                  key={t.id}
                  className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <p
                    className={
                      t.role === "user"
                        ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-white/[0.09] px-3.5 py-2 text-sm leading-relaxed text-ink"
                        : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm leading-relaxed text-ink-2"
                    }
                  >
                    {t.role === "user" ? t.text : <Reply text={t.text} />}
                  </p>
                </li>
              ))}
              {thinking && (
                <li className="flex justify-start">
                  <p className="rounded-2xl rounded-bl-sm border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm text-ink-3">
                    Thinking
                  </p>
                </li>
              )}
            </ul>
          )}
        </div>

        {problem && (
          <p className="py-2 text-[11px] text-ink-3" role="status">
            {problem}
          </p>
        )}

        {/* The empty state and the conversation share one column, and only the
            arrangement of it changes: with nothing said, the opening and the
            prompt box sit together in the middle as a single thing to look at,
            and the first message moves the prompt box down to the bottom so the
            messages get the height. The prompt box itself is one element that
            changes position rather than two that swap, so a half-typed question
            survives the move and the box never blinks. */}
        <motion.div
          data-mentor-composer
          layout={!reduced}
          transition={reduced ? undefined : { type: "spring", stiffness: 420, damping: 38 }}
          className={
            empty
              ? "flex w-full max-w-2xl shrink-0 flex-col gap-3"
              : "flex w-full shrink-0 flex-col gap-2 border-t border-white/[0.07] py-3"
          }
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={box}
              value={draft}
              rows={1}
              maxLength={2000}
              placeholder="Ask about your log…"
              aria-label="Message the mentor"
              onChange={(e) => {
                setDraft(e.target.value);
                grow(e.target);
              }}
              onKeyDown={(e) => {
                /* Enter sends, Shift+Enter breaks the line — the convention
                   everywhere else the user has typed. */
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-3/70 focus:border-white/20 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || thinking}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/15 text-ink-2 transition-colors enabled:hover:bg-white/[0.07] disabled:opacity-30"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 13V3M8 3L4 7M8 3l4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          {empty && (
            <p className="text-center text-[11px] text-ink-3/80">
              Nothing is sent until you send something. Progress photos are never included.
            </p>
          )}
        </motion.div>
      </motion.div>

        {/* A quiet line for the one thing a conversation hides: how to get back
            to the rest of them. It does not exist on the fresh screen, where the
            log already makes that obvious — it is the ongoing-chat equivalent,
            and it names the thing it points to. Sits under the prompt box as a
            caption, so the input never has to move to make room for it. */}
        {!empty && (
          <p className="shrink-0 px-3 pb-3 pt-1 text-center text-[11px] text-ink-3/80">
            This stays saved. The + at the top brings up your Recent chats.
          </p>
        )}

        {/* The way back to a saved chat. It lives on the fresh screen because
            that is the screen where you could be lost: a conversation is in
            front of you, and the log below the prompt box is the door out of it
            that needs no thinking. Pinned to the bottom edge, under the
            centred prompt box — it is a list to scan, not another thing to
            read in the middle of the screen. */}
        {empty && recents.length > 0 && (
          <RecentChats
            chats={recents}
            onOpen={openChat}
            onRename={setChatTitle}
            onDelete={(id) => setDeleting(recents.find((c) => c.id === id) ?? null)}
          />
        )}
      </div>

      {deleting && (
        <ConfirmDeleteChat
          chat={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            deleteChat(deleting.id);
            setDeleting(null);
          }}
        />
      )}

      {showSettings && (
        <SettingsDialog
          notes={mentor.settings.notes}
          onNotes={setNoteReading}
          events={mentor.settings.events}
          onEvents={setEventSharing}
          showNew={turns.length > 0}
          onNewChat={newChat}
          onClose={() => setShowSettings(false)}
          transcript={context}
        />
      )}
    </PageShell>
  );
}

/**
 * The door back to a saved chat, rendered under the centred prompt box on the
 * fresh screen.
 *
 * Every row is three buttons side by side because a row that can rename and
 * delete itself is not one button: the open target fills the row, and rename
 * and delete sit at its edge with their own labels. Rename edits the row in
 * place, one row at a time — a dialog per rename would be more ceremony than
 * typing one word. Delete cannot be that casual, so it goes through
 * `ConfirmDeleteChat` first.
 *
 * The row shows the chat's name if it has one and its first message if it does
 * not, so a rename is the difference between a list you recognise and a list
 * you have to read. See `chatLabel`; the timestamp is coarse on purpose, see
 * `whenLabel`.
 */
function RecentChats({
  chats,
  onOpen,
  onRename,
  onDelete,
}: {
  chats: readonly MentorChat[];
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const editing = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) editing.current?.focus();
  }, [renaming]);

  const startRename = (c: MentorChat) => {
    /* Starts on the name rather than on a blank box: the name is the thing
       being edited, and an empty field that saves to "no name" on a stray Enter
       throws away a name somebody bothered to type. */
    setDraft(c.title ?? "");
    setRenaming(c.id);
  };

  const finishRename = () => {
    if (renaming) onRename(renaming, draft);
    setRenaming(null);
  };

  return (
    <nav aria-label="Recent chats" className="shrink-0 border-t border-white/[0.07] px-3 pb-3 pt-2">
      <span className="label-xs text-ink-3">Recent chats</span>
      <ul className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto">
        {chats.map((c) => {
          const short = chatLabelShort(c);
          return (
            <li key={c.id} className="flex items-center gap-1.5">
              {renaming === c.id ? (
                <input
                  ref={editing}
                  value={draft}
                  maxLength={MAX_TITLE}
                  aria-label={`Name for ${chatLabel(c)}`}
                  placeholder="Name this chat"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    /* Enter takes the name and Escape drops it. Escape
                       reverting rather than clearing matters: a name the user
                       does not mean to change must survive a mis-key. */
                    if (e.key === "Enter") {
                      e.preventDefault();
                      finishRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setRenaming(null);
                    }
                  }}
                  /* Blur saves, because a name typed and then abandoned by
                     clicking away is worse than one that took effect. Escape
                     above is the way out for someone who changed their mind. */
                  onBlur={finishRename}
                  className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1.5 text-xs text-ink placeholder:text-ink-3/70 focus:border-white/25 focus:outline-none"
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    aria-label={`Open chat ${short}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.07]"
                  >
                    {/* A chat someone named reads one step brighter than one
                        still showing its first message. That is the whole
                        signal — a second icon on the row would say "this is
                        editable" on something that is not the open button. */}
                    <span className={c.title ? "truncate text-xs text-ink" : "truncate text-xs text-ink-2"}>
                      {short}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-3/80">{whenLabel(c.lastAt)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(c)}
                    aria-label={`Rename chat ${short}`}
                    className="rounded-md p-1.5 text-ink-3/60 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
                  >
                    <Pencil size={13} strokeWidth={1.75} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    aria-label={`Delete chat ${short}`}
                    className="rounded-md p-1.5 text-ink-3/60 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
                  >
                    <Trash2 size={13} strokeWidth={1.75} aria-hidden />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The one confirmation on this tab, and it is behind the only irreversible thing
 * on it.
 *
 * A row of recent chats is exactly where a stray thumb lands: the delete button
 * is the rightmost of three small targets on a strip pinned to the bottom edge
 * of the screen, inches from a home button, and the mistake it causes is silent
 * and total. The dialog names the conversation and counts what goes with it,
 * because the number is what makes someone read it, and it says plainly that
 * there is no undo — the only reason to keep going is wanting to.
 *
 * Focus starts on Keep it, so the safe choice is the one a stray Enter press
 * takes, and Escape leaves. Same posture as the habit delete behind it.
 */
function ConfirmDeleteChat({
  chat,
  onCancel,
  onConfirm,
}: {
  chat: MentorChat;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  const count = chat.turns.length;

  useEffect(() => {
    keep.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={solid.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Delete chat ${chatLabel(chat)}`}
    >
      <div className="w-full max-w-sm p-5" style={solid.card}>
        <span className="label-xs">Are you sure?</span>

        <p className="mt-3 text-sm text-ink">
          Delete <span className="font-medium">{chatLabel(chat)}</span>?
        </p>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {count === 1
            ? <>That takes the one message with it. There is no undo.</>
            : <>That takes {count} messages with it. There is no undo.</>}
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={keep}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-hairline px-3 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-[var(--color-accent)]"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border px-3 py-1.5 text-[11px] font-medium text-ink transition-colors"
            style={{ borderColor: "var(--color-low)" }}
          >
            Delete chat
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A mentor turn, with the two characters of markdown it is allowed to use
 * rendered.
 *
 * Only the model's own words go through this. What the user typed is shown
 * exactly as they typed it, because a `*` in a question about a maths grade or
 * a file name is a character, not a formatting request.
 *
 * Bold is the only weight used. The bubble is already `text-sm` in a muted ink
 * and the reply sits inside a rounded surface; a heavier weight inside a
 * sentence is the one emphasis that reads as emphasis and not as a different
 * kind of thing. See `parseInline` for why this is not a markdown library.
 */
function Reply({ text }: { text: string }) {
  const spans = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {spans.map((s, i) =>
        s.kind === "strong" ? (
          <strong key={i} className="font-semibold text-ink">
            {s.text}
          </strong>
        ) : s.kind === "em" ? (
          <em key={i}>{s.text}</em>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Behind a cogwheel because there is one thing in here and it is a privacy
 * switch, not a preference. Anything the user might want to change weekly
 * belongs on the page in front of them; a single opt-in that governs what leaves
 * the device is the opposite of that, and burying it is how it gets left on by
 * someone who forgot they had turned it on.
 */
function SettingsDialog({
  notes,
  onNotes,
  events,
  onEvents,
  showNew,
  onNewChat,
  onClose,
  transcript,
}: {
  notes: boolean;
  onNotes: (on: boolean) => void;
  events: boolean;
  onEvents: (on: boolean) => void;
  showNew: boolean;
  onNewChat: () => void;
  onClose: () => void;
  transcript: string;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={solid.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Mentor settings"
    >
      <div className="w-full max-w-sm p-5" style={solid.card}>
        <div className="flex items-center justify-between gap-3">
          <span className="label-xs">Settings</span>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded px-1 text-sm text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
          >
            &#215;
          </button>
        </div>

        <label className="mt-4 flex cursor-pointer items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm text-ink">Let it read your notes</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">
              Off, nothing you have written is sent. On, the most recent {NOTES_INFO.count} notes go
              with your numbers, capped at {NOTES_INFO.chars} characters each.
            </span>
          </span>
          <span className="relative mt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={notes}
              onChange={(e) => onNotes(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="block h-5 w-9 rounded-full transition-colors peer-checked:bg-white/30 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-white/60"
              style={{ background: notes ? "#ffffff40" : "#ffffff14" }}
            />
            <span
              aria-hidden
              className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-transform peer-checked:translate-x-4"
              style={{ background: "var(--color-ink)" }}
            />
          </span>
        </label>

        <label className="mt-3 flex cursor-pointer items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm text-ink">Share your calendar</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">
              Off, the mentor cannot see your calendar. On, events from the last{" "}
              {EVENTS_INFO.past} days and the next {EVENTS_INFO.future} go with your numbers —
              <span className="text-ink-2"> titles included, and a title may name someone</span>.
            </span>
          </span>
          <span className="relative mt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={events}
              onChange={(e) => onEvents(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="block h-5 w-9 rounded-full transition-colors peer-checked:bg-white/30 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-white/60"
              style={{ background: events ? "#ffffff40" : "#ffffff14" }}
            />
            <span
              aria-hidden
              className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-transform peer-checked:translate-x-4"
              style={{ background: "var(--color-ink)" }}
            />
          </span>
        </label>

        <p className="mt-4 text-[10px] leading-relaxed text-ink-3/80">
          Messages go to OpenAI, which retains them for 30 days. Progress photos are never
          included — the mentor cannot see images.
        </p>

        {/* The transcript, shown rather than promised.
         *
         * This is the exact string the route posts as the context, not a summary of it and not a
         * re-render of the same inputs through different code — it is built by calling buildContext
         * on the brief the screen already sends, so what is shown and what is sent cannot drift.
         * Read-only by design: editing it here would describe a conversation that is not the one
         * the mentor has. */}
        {showTranscript ? (
          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="label-xs">What gets sent</span>
              <button
                type="button"
                onClick={() => setShowTranscript(false)}
                className="rounded px-1 text-[11px] text-ink-3 transition-colors hover:text-ink-2"
              >
                Hide
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-3/80">
              Read-only. Rebuilt every time you open this, from the same numbers a message uses.
            </p>
            <pre
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-hairline p-2 text-[10px] leading-relaxed text-ink-2"
              aria-label="Transcript sent to the mentor"
            >
              {transcript}
            </pre>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowTranscript(true)}
            className="mt-4 w-full rounded-md border border-hairline px-3 py-2 text-[11px] text-ink-2 transition-colors hover:border-[var(--color-accent)]"
          >
            See what gets sent to the AI
          </button>
        )}

        {showNew && (
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/[0.07] pt-4">
            <button
              type="button"
              onClick={() => {
                onNewChat();
                onClose();
              }}
              className="rounded-md border border-hairline px-3 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-[var(--color-accent)]"
            >
              Start a new chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
