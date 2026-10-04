/**
 * Wren's opening lines, shown on the fresh screen.
 *
 * One fixed line is the first thing anyone reads about a tab that claims to be
 * open, and it sets the voice for everything after it. The first version led
 * with the log and ended on a limit, which read as a gatekeeper on a tab that
 * is meant to be talked to about anything. So the register here is the same one
 * the prompt asks for: an invitation first, and where the log is mentioned at
 * all it is one of several things on offer rather than the terms of entry.
 *
 * Every line has to stay true. Wren does see the numbers the app worked out,
 * will talk about feelings and problems at length, and says so when the numbers
 * cannot answer something — so no line may promise more than that, and none may
 * claim to see a photo, a message, or a location.
 */
const OPENINGS = [
  "Tell me anything — how your week went, how you are feeling, or what to do about it.",
  "Anything goes. A bad day, a stuck problem, or something you just want to talk through.",
  "You do not need a question. Say what is on your mind.",
  "Ask me about your day, your feelings, or what the numbers say. All of it counts.",
  "I am here for whatever you want to say, including the parts that are not in your log.",
  "I can see what your app has worked out — sleep, check-ins, lifts, weight, money — and I can talk to you about anything else too.",
  "Talk to me about your life or your log. Where the numbers cannot answer, I will say so rather than guess.",
  "Something on your mind? Start anywhere.",
] as const;

/**
 * Called during the server render, not in the browser, for the same reason
 * @/lib/welcomes rolls its dice there: /mentor is `force-dynamic`, so the
 * chosen line ships down in the payload and the two sides agree. Choosing in the
 * browser would mean the server picked one line and React swapped it for
 * another immediately after paint. It also holds still for as long as the page
 * is open, so a reply arriving mid-conversation never changes the line out from
 * under the reader.
 */
export function randomOpening(): string {
  return OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
}

/** Exported for tests: the full set of lines a reload can produce. */
export const OPENING_SET: readonly string[] = OPENINGS;
