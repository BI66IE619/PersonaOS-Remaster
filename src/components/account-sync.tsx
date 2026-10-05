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
import {
  claimTasksOwnership,
  getServerSnapshot as getTasksServer,
  getSnapshot as getTasks,
  subscribe as tasksSubscribe,
} from "@/lib/tasks";
import {
  claimHabitsOwnership,
  getServerSnapshot as getHabitsServer,
  getSnapshot as getHabits,
  subscribe as habitsSubscribe,
} from "@/lib/habits";
import { scheduleJournalSync, syncJournalNow } from "@/lib/journal/sync";
import { schedulePlansSync, syncPlansNow } from "@/lib/plans/sync";

/**
 * Binds every account-owned store to the signed-in user and keeps them syncing.
 *
 * One boundary rather than logic inside each screen, because these stores are read
 * and written from more than one tab and every one of them would otherwise have to
 * remember to claim and to schedule. This is not a nicety: the plan stores — tasks,
 * events and habits — used to be claimed and synced only by the Plan tab, so
 * checking a habit off on Home changed the local record and pushed nothing, and a
 * device that only ever opened Home never claimed them at all and showed the sample
 * data instead of the account's.
 *
 * The claim happens during render, before any sibling reads a snapshot, so the first
 * frame does not show the previous account's data. It is idempotent, and the reads
 * that follow it are the same snapshot every consumer gets.
 */
export function AccountSync({ userId }: { userId: string }) {
  if (getNotes().owner !== userId) claimNotesOwnership(userId);
  if (getCheckIns().owner !== userId) claimCheckInsOwnership(userId);
  if (getWeight().owner !== userId) claimWeightOwnership(userId);
  if (getSports().owner !== userId) claimSportsOwnership(userId);
  if (getStrength().owner !== userId) claimStrengthOwnership(userId);
  if (getTasks().owner !== userId) claimTasksOwnership(userId);
  if (getHabits().owner !== userId) claimHabitsOwnership(userId);

  /* Subscribed so any write path schedules a sync, wherever it happened. */
  const notes = useSyncExternalStore(notesSubscribe, getNotes, getNotesServer);
  const checkins = useSyncExternalStore(checkInsSubscribe, getCheckIns, getCheckInsServer);
  const weight = useSyncExternalStore(weightSubscribe, getWeight, getWeightServer);
  const sports = useSyncExternalStore(sportsSubscribe, getSports, getSportsServer);
  const strength = useSyncExternalStore(strengthSubscribe, getStrength, getStrengthServer);
  const tasks = useSyncExternalStore(tasksSubscribe, getTasks, getTasksServer);
  const habits = useSyncExternalStore(habitsSubscribe, getHabits, getHabitsServer);

  /* First pull immediate rather than debounced, so a device that already has data
     server-side does not sit on an empty screen for the debounce window. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void syncJournalNow();
    void syncPlansNow();
  }, []);

  useEffect(() => {
    if (!started.current) return;
    scheduleJournalSync();
  }, [notes, checkins, weight, sports, strength]);

  useEffect(() => {
    if (!started.current) return;
    schedulePlansSync();
  }, [tasks, habits]);

  return null;
}
