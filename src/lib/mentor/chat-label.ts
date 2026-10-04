import type { MentorChat } from "@/lib/mentor/types";

/** How much of a first message fits a recents-log row before it is cut. */
const PREVIEW_CHARS = 48;

/**
 * What a chat calls itself in the recents log.
 *
 * The fallback is the first thing the user typed, not the last thing they saw:
 * a row is recognised by how it began, and a preview taken from the end of a
 * conversation reads as an answer to something you don't remember asking. A
 * chat with no user turn at all cannot happen through the UI — turns alternate
 * from a user message — so the second branch is a shape the store allows rather
 * than one a person can reach.
 */
export function chatLabel(chat: MentorChat): string {
  if (chat.title) return chat.title;
  const first = chat.turns.find((t) => t.role === "user")?.text ?? "Chat";
  return first.length > PREVIEW_CHARS ? `${first.slice(0, PREVIEW_CHARS).trimEnd()}…` : first;
}

/** The text the log puts on the page, which a long name is cut down to fit a
 *  row without wrapping it onto two lines. */
export function chatLabelShort(chat: MentorChat): string {
  const label = chatLabel(chat);
  return label.length > PREVIEW_CHARS ? `${label.slice(0, PREVIEW_CHARS).trimEnd()}…` : label;
}
