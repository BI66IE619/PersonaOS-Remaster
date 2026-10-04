import { NICKNAME } from "./persona";

/**
 * Welcomes for the top of Home. "{n}" is the name.
 *
 * The variety is picked per request rather than per day so a reload feels
 * different each time. The list is deliberately all one register: flat, no
 * time-of-day wording, and nothing that comments on how you did last time.
 * A greeting that says "welcome back" is a statement about a return; paired
 * with a headline verdict two inches below it, it can read as a dig.
 */
const WELCOMES = [
  "Welcome back, {n}",
  "Good to see you, {n}",
  "Howdy, {n}",
  "Let's get after it, {n}",
  "Back at it, {n}",
  "Ready when you are, {n}",
  "Nice to see you, {n}",
  "Hey {n}, let's go",
] as const;

/**
 * Called during the server render, not in the browser.
 *
 * This is the whole trick to a random greeting that does not fight hydration:
 * Home is `force-dynamic`, so every reload re-renders on the server, and the
 * chosen string ships down in the payload the client hydrates from. The two
 * sides therefore always agree. Rolling the dice in the browser instead would
 * mean the server guessed one text and React replaced it with another right
 * after paint — a visible jump, and a hydration warning to silence.
 */
export function randomWelcome(): string {
  return WELCOMES[Math.floor(Math.random() * WELCOMES.length)].replace("{n}", NICKNAME);
}

/** Exported for tests: the full set of strings a reload can produce. */
export const WELCOME_SET: readonly string[] = WELCOMES.map((w) => w.replace("{n}", NICKNAME));
