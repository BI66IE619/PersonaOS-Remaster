/**
 * The small piece of markdown a chat reply is allowed to use.
 *
 * The model writes `**Lab report due**` because that is how a language model
 * marks a name it wants to stand out, and a chat bubble that shows the
 * asterisks is reading as broken rather than as plain. So the two characters
 * are rendered.
 *
 * That is the entire scope on purpose. Full markdown means headings, links,
 * tables, code fences and images, and this app must not turn a reply into a
 * document: a link the model invented is a thing the user would tap, an image
 * written by a model is a remote request to a host the user knows nothing
 * about, and a table inside a chat bubble on a phone is a horizontal scroll.
 * There is no HTML here either — the output is a list of spans that a
 * component turns into elements, so there is no markup to inject and no
 * sanitiser to get wrong.
 *
 * Unbalanced markers stay literal, because half of a pair of asterisks is
 * something a person means to see.
 */

export type Span = { kind: "text" | "strong" | "em"; text: string };

/** A `*` that runs on into the next sentence is a multiplication sign, not an
 *  emphasis delimiter. Markdown has the same rule, and without it `2 * 3 * 4`
 *  loses half its characters. */
const MAX_RUN = 200;

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/**
 * Splits a reply into text, bold and italic spans.
 *
 * `**` is checked first, so a double marker never gets read as two italics.
 */
export function parseInline(md: string): Span[] {
  const spans: Span[] = [];
  let text = "";
  let i = 0;

  const flush = () => {
    if (text) spans.push({ kind: "text", text });
    text = "";
  };

  while (i < md.length) {
    const c = md[i];

    /* A backslash is the model's way of saying "this asterisk is a character,
       not formatting", which it does when it quotes a title containing one.
       Dropping the backslash and keeping the character is the whole point of
       the escape. */
    if (c === "\\" && (md[i + 1] === "*" || md[i + 1] === "_")) {
      text += md[i + 1];
      i += 2;
      continue;
    }

    if (c === "*" || c === "_") {
      const strong = md.startsWith(c.repeat(2), i);
      const marker = strong ? c.repeat(2) : c;
      const start = i + marker.length;
      const close = md.indexOf(marker, start);

      /* No closer, or a closer that would swallow a whole sentence, or empty
         content, or a delimiter sitting against a space — all of which mean
         these characters are literal. */
      if (
        close !== -1 &&
        close > start &&
        close - start <= MAX_RUN &&
        !isSpace(md[start]) &&
        !isSpace(md[close - 1])
      ) {
        flush();
        spans.push({ kind: strong ? "strong" : "em", text: md.slice(start, close) });
        i = close + marker.length;
        continue;
      }
    }

    text += c;
    i += 1;
  }

  flush();
  return spans;
}

/** Whether a reply would show any marker to the reader. Used by the test to
 *  assert a rendered bubble has nothing left over, rather than asserting that
 *  some particular word is absent. */
export const hasUnrenderedMarker = (md: string) =>
  parseInline(md).some((s) => s.kind === "text" && /\*\*|(?<!\\)[*_]/.test(s.text));
