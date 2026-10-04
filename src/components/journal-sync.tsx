"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  claimNotesOwnership,
  getServerSnapshot as getNotesServer,
  getSnapshot as getNotes,
  subscribe as notesSubscribe,
} from "@/lib/notes";
import {
  claimCheckInsOwnership,
  getServerSnapshot as getCheckInsServer,
  getSnapshot as getCheckIns,
  subscribe as checkInsSubscribe,
} from "@/lib/checkins";
import {
  claimWeightOwnership,
  getServerSnapshot as getWeightServer,
  getSnapshot as getWeight,
  subscribe as weightSubscribe,
} from "@/lib/weight-log";
import {
  claimSportsOwnership,
  getServerSnapshot as getSportsServer,
  getSnapshot as getSports,
  subscribe as sportsSubscribe,
} from "@/lib/sports";
import {
  claimStrengthOwnership,
  getServerSnapshot as getStrengthServer,
  getSnapshot as getStrength,
  subscribe as strengthSubscribe,
} from "@/lib/strength";
import { scheduleJournalSync, syncJournalNow } from "@/lib/journal/sync";

/**
 * Binds the journal stores to the signed-in account and keeps them syncing.
 *
 * A boundary rather than logic inside each screen, because notes, check-ins and
 * weigh-ins are read from five different tabs (Notes, Vitality, Body, Home and
 * Mentor) and every one of them would otherwise have to remember to claim. It
 * renders nothing; mount it above the screen.
 *
 * The claim happens during render, before any sibling reads a snapshot. An effect
 * would be one paint too late: the first frame would show the previous account's
 * journal. The stores are module singletons, so this is a write during render —
 * safe only because the claim is idempotent and every following read is the same
 * snapshot.
 */
export function JournalSync({ userId }: { userId: string }) {
  if (getNotes().owner !== userId) claimNotesOwnership(userId);
  if (getCheckIns().owner !== userId) claimCheckInsOwnership(userId);
  if (getWeight().owner !== userId) claimWeightOwnership(userId);
  if (getSports().owner !== userId) claimSportsOwnership(userId);
  if (getStrength().owner !== userId) claimStrengthOwnership(userId);

  /* Subscribed so every write path — a note saved, a check-in rated, a weight
     logged or removed, a sport session added or deleted, a set logged or a
     movement changed — schedules a sync without each call site remembering to. */
  const notes = useSyncExternalStore(notesSubscribe, getNotes, getNotesServer);
  const checkins = useSyncExternalStore(checkInsSubscribe, getCheckIns, getCheckInsServer);
  const weight = useSyncExternalStore(weightSubscribe, getWeight, getWeightServer);
  const sports = useSyncExternalStore(sportsSubscribe, getSports, getSportsServer);
  const strength = useSyncExternalStore(strengthSubscribe, getStrength, getStrengthServer);

  /* The first pull is immediate rather than debounced, so a device that already
     has data server-side does not sit on an empty journal for the debounce
     window. Every later change coalesces. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void syncJournalNow();
  }, []);

  useEffect(() => {
    if (!started.current) return;
    scheduleJournalSync();
  }, [notes, checkins, weight, sports, strength]);

  return null;
}
