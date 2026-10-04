"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { addDays, shortDayLabel } from "@/lib/dates";
import {
  TAG_LIMIT,
  allTags,
  byDate,
  clearNotes,
  getServerSnapshot,
  getSnapshot,
  normalizeTags,
  removeEntry,
  saveEntry,
  searchEntries,
  seedNotes,
  snippet,
  subscribe,
} from "@/lib/notes";
import type { JournalEntry } from "@/lib/types";

const EMPTY = (date: string): JournalEntry => ({ date, note: "", tags: [] });

export function NotesScreen({ today }: { today: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [date, setDate] = useState(today);
  const [saved, setSaved] = useState(false);
  /* Unsaved edits win over storage. */
  const [draft, setDraft] = useState<JournalEntry | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  /* First run gets a short archive so the panel is not an empty list. */
  useEffect(() => {
    seedNotes(today);
  }, [today]);

  const stored = byDate(state.entries, date);
  const entry = draft?.date === date ? draft : stored;
  const tags = allTags(state.entries);
  const results = searchEntries(state.entries, query, tag);
  const filtering = query.trim().length > 0 || tag !== null;

  const goTo = (next: string) => {
    if (next > today) return;
    setDate(next);
    setDraft(null);
    setSaved(false);
    setTagDraft("");
  };

  const setTags = (next: string[]) =>
    setDraft({ ...(entry ?? EMPTY(date)), tags: next });

  const commitTag = () => {
    const raw = tagDraft.trim();
    setTagDraft("");
    if (!raw) return;
    const next = normalizeTags([...(entry?.tags ?? []), raw]);
    if (next.length === (entry?.tags ?? []).length) return;
    setTags(next);
  };

  const save = () => {
    saveEntry(date, { note: entry?.note ?? "", tags: entry?.tags ?? [] });
    setDraft(null);
    setTagDraft("");
    setSaved(true);
  };

  /* An existing day can be emptied out to delete it, so keep the button live
     when there is something stored to clear. Otherwise clearing the text
     would leave a ghost row that can never be saved away. */
  const canSave = (!!entry && entry.note.trim().length > 0) || !!stored;

  return (
    <PageShell>
        <header className="py-4">
          <h1 className="text-sm font-medium">Notes</h1>
          <p className="mt-1 text-[11px] text-ink-3">Ideas, thoughts, things worth remembering.</p>
        </header>

        <main className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <section className="panel p-5 lg:col-span-7">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goTo(addDays(date, -1))}
                  aria-label="Previous day"
                  className="rounded px-1.5 py-0.5 text-sm text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
                >
                  &#8249;
                </button>
                <span className="num min-w-[104px] text-center text-xs text-ink-2">
                  {shortDayLabel(date)}
                </span>
                <button
                  type="button"
                  onClick={() => goTo(addDays(date, 1))}
                  disabled={date >= today}
                  aria-label="Next day"
                  className="rounded px-1.5 py-0.5 text-sm text-ink-3 transition-colors enabled:hover:bg-white/[0.07] enabled:hover:text-ink-2 disabled:opacity-25"
                >
                  &#8250;
                </button>
              </div>
              {date !== today ? (
                <button
                  type="button"
                  onClick={() => goTo(today)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-[10px] text-ink-3 transition-colors hover:text-ink-2"
                >
                  Back to today
                </button>
              ) : null}
            </div>

            <textarea
              value={entry?.note ?? ""}
              onChange={(e) => {
                setSaved(false);
                setDraft({ ...(entry ?? EMPTY(date)), note: e.target.value });
              }}
              placeholder="Anything worth remembering?"
              aria-label="Note"
              rows={12}
              className="mt-4 w-full resize-y rounded-lg border border-hairline bg-white/[0.07] px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
            />

            {entry?.tags.length ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {entry.tags.map((t) => (
                  <li key={t.toLowerCase()}>
                    <span className="flex items-center gap-1 rounded-full border border-hairline bg-white/[0.07] py-0.5 pl-2 pr-1 text-[11px] text-ink-2">
                      {t}
                      <button
                        type="button"
                        onClick={() => setTags(entry.tags.filter((x) => x !== t))}
                        aria-label={`Remove tag ${t}`}
                        className="rounded-full px-1 text-ink-3 transition-colors hover:text-[var(--color-low)]"
                      >
                        &#10005;
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 flex gap-2">
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    commitTag();
                  }
                }}
                placeholder={
                  (entry?.tags.length ?? 0) >= TAG_LIMIT
                    ? `Tag limit reached (${TAG_LIMIT})`
                    : "Add a tag, press Enter"
                }
                disabled={(entry?.tags.length ?? 0) >= TAG_LIMIT}
                aria-label="Add a tag"
                className="min-w-0 flex-1 rounded-lg border border-hairline bg-white/[0.07] px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={commitTag}
                disabled={!tagDraft.trim() || (entry?.tags.length ?? 0) >= TAG_LIMIT}
                className="shrink-0 rounded-lg border border-hairline-strong bg-raised px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-inset disabled:cursor-not-allowed disabled:opacity-40"
              >
                Tag
              </button>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="rounded-lg border border-hairline-strong bg-raised px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-inset disabled:cursor-not-allowed disabled:opacity-40"
              >
                {stored ? "Update" : "Save"}
              </button>
              {saved ? <span className="text-[11px] text-[var(--color-good)]">Saved</span> : null}
            </div>
          </section>

          <section className="panel flex flex-col p-5 lg:col-span-5">
            <div className="flex items-center justify-between gap-3">
              <span className="label-xs">Archive</span>
              <span className="num text-[10px] text-ink-3">
                {state.entries.length
                  ? filtering
                    ? `${results.length} of ${state.entries.length}`
                    : `${state.entries.length} ${state.entries.length === 1 ? "entry" : "entries"}`
                  : ""}
              </span>
            </div>

            {state.entries.length ? (
              <>
                <div className="mt-3 flex gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search notes"
                    aria-label="Search notes"
                    className="min-w-0 flex-1 rounded-lg border border-hairline bg-white/[0.07] px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
                  />
                  {filtering ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setTag(null);
                      }}
                      aria-label="Clear search and filter"
                      className="shrink-0 rounded-lg border border-hairline px-3 py-2 text-sm text-ink-3 transition-colors hover:text-ink-2"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                {tags.length ? (
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {tags.map((t) => {
                      const on = tag?.toLowerCase() === t.toLowerCase();
                      return (
                        <li key={t.toLowerCase()}>
                          <button
                            type="button"
                            onClick={() => setTag(on ? null : t)}
                            aria-pressed={on}
                            className="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                            style={{
                              borderColor: on ? "var(--color-hairline-strong)" : "var(--color-hairline)",
                              background: on ? "var(--color-raised)" : "transparent",
                              color: on ? "var(--color-ink)" : "var(--color-ink-3)",
                            }}
                          >
                            {t}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </>
            ) : null}

            {state.entries.length ? (
              results.length ? (
                <ul className="mt-3 space-y-1">
                  {results.map((e) => {
                    const on = e.date === date;
                    return (
                      <li key={e.date} className="group flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => goTo(e.date)}
                          aria-label={`Open note for ${shortDayLabel(e.date)}`}
                          aria-current={on ? "true" : undefined}
                          className="min-w-0 flex-1 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-hairline hover:bg-white/[0.04]"
                          style={on ? { background: "var(--color-raised)", borderColor: "var(--color-hairline)" } : undefined}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="num text-[11px] text-ink-2">{shortDayLabel(e.date)}</span>
                          </div>
                          {e.note.trim() ? (
                            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-3">
                              {snippet(e.note, query)}
                            </p>
                          ) : null}
                          {e.tags.length ? (
                            <p className="num mt-1 truncate text-[10px] text-ink-3">{e.tags.join(" · ")}</p>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeEntry(e.date)}
                          aria-label={`Delete note for ${shortDayLabel(e.date)}`}
                          className="mt-2 shrink-0 rounded px-1 text-[11px] text-ink-3 opacity-0 transition-opacity hover:text-[var(--color-low)] focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          &#10005;
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                /* A failed search is a dead end, so it says which word failed and
                   offers the way out rather than only reporting the absence. */
                <EmptyState
                  title="Nothing matches that."
                  detail={`No entry contains "${query}". Clear the search to see all of them again.`}
                  action={{
                    label: "Clear the search",
                    onClick: () => {
                      setQuery("");
                      setTag(null);
                    },
                  }}
                />
              )
            ) : (
              <EmptyState
                title="No notes yet."
                detail="Write one a day and it saves itself. Everything you write collects here, newest first, and you can search or tag it later."
              />
            )}

            {state.entries.length ? (
              <button
                type="button"
                onClick={clearNotes}
                className="mt-4 self-start text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
              >
                Clear all notes
              </button>
            ) : null}
          </section>
        </main>
    </PageShell>
  );
}
