import { buildSystem } from "@/lib/mentor/prompt";
import type { CrisisFlag } from "@/lib/mentor/types";
import { getUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The one request the app makes, and the only place a key is read.
 *
 * Everything the model is allowed to know is assembled on the device by
 * buildBrief and posted here as a finished string. The client never sends raw
 * store data, so this route cannot accidentally become a way to exfiltrate the
 * log by accident: what arrives is already the payload, and the only thing worth
 * guarding here is the key and the shape of the reply.
 *
 * The provider is OpenAI directly. OpenCode Zen fronts the same models and was
 * the original target, but a Zen key is not an OpenAI key — Zen returned 401 on
 * one — so the app is pointed at the account the key actually belongs to rather
 * than at a gateway that was never going to accept it.
 */
const ENDPOINT = "https://api.openai.com/v1/responses";
const MODEL = "gpt-6-luna";

/** Two or three sentences is the target, and the prompt says so. This is a
 *  ceiling on a runaway reply, not an allowance — the model almost never comes
 *  close. */
const MAX_OUTPUT_TOKENS = 800;

/** Enough room for a real conversation, and no more. */
const MAX_TURNS = 20;
const MAX_USER_CHARS = 2000;
const MAX_CONTEXT_CHARS = 20_000;
const MAX_REPLY_CHARS = 4000;

const isStr = (v: unknown): v is string => typeof v === "string";

type Reply =
  | { text: string }
  | { crisis: CrisisFlag }
  | { error: string };

export async function POST(request: Request): Promise<Response> {
  /* Signed out, this route is one of the few that owes the caller a session.
     Before auth existed it was open to anyone who could reach the deployment,
     which meant an unauthenticated way to spend the account's OpenAI balance —
     the key is the only thing being paid for, and a stranger could have driven it
     to zero. The 401 is checked before the key is even read, so an unauthenticated
     call cannot learn whether one is configured.

     A 401 and not a redirect: this is fetch() from a client component, and
     redirecting it would hand the caller an HTML sign-in page where it expects
     JSON. The client is expected to route to "/" on seeing this. */
  if (!(await getUserId())) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    /* Not a crash. The tab is still perfectly usable without it, and saying so
     * is better than an error the user cannot act on. */
    return Response.json(
      { error: "The mentor is not connected yet. It needs an API key on the server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const o = (body ?? {}) as Record<string, unknown>;

  const context = isStr(o.context) ? o.context.slice(0, MAX_CONTEXT_CHARS) : "";
  const history = Array.isArray(o.turns) ? o.turns : [];
  const message = isStr(o.message) ? o.message.trim().slice(0, MAX_USER_CHARS) : "";

  if (!message) return Response.json({ error: "Nothing to say." }, { status: 400 });
  if (!context) return Response.json({ error: "No context." }, { status: 400 });

  /* History is rebuilt from roles and text alone, and a turn that is neither
     role is dropped, so nothing in localStorage can reach the model as a
     forged system message. */
  const prior = history
    .flatMap((t) => {
      if (!t || typeof t !== "object") return [];
      const c = t as Record<string, unknown>;
      if (!isStr(c.text) || !c.text.trim()) return [];
      if (c.role !== "user" && c.role !== "assistant") return [];
      return [{ role: c.role as "user" | "assistant", content: c.text.trim().slice(0, MAX_USER_CHARS) }];
    })
    .slice(-MAX_TURNS);

  const input = [
    ...prior,
    { role: "user" as const, content: message },
  ];

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: `${buildSystem()}\n\nTHE USER'S LOG AS THE APP READS IT\n\n${context}`,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        /* Reasoning is dialled down rather than left to default.
         *
         * gpt-6-luna is a reasoning model, and reasoning tokens come out of the
         * same budget as the reply. Left alone it spent 126 of 400 tokens
         * thinking before saying anything, and with a tighter budget — or a
         * harder question — it can spend all of them, returning a `reasoning`
         * item and no message at all. The route then has a 200 with nothing in
         * it and reports "Empty reply." for no visible reason. "low" is where
         * the measured replies are identical in content and about a third of
         * the cost, and it leaves the cap free to hold actual text.
         */
        reasoning: { effort: "low" },
        /* Nothing is kept against the user: the conversation lives in
           localStorage and this is the only copy. OpenAI still holds requests for
           up to 30 days for abuse monitoring, which the settings dialog says
           out loud. */
        store: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return Response.json({ error: "The mentor could not be reached." }, { status: 502 });
  }

  if (!res.ok) {
    /* The status is passed through rather than swallowed: a 401 means the key is
       wrong and a 429 means it cannot run right now, and those are very
       different things to be told.

       A 429 is read more closely, because it means two unrelated things — an
       empty balance and a request that came too fast — and the fix is on a
       completely different page for each. Collapsing them into "out of credit"
       would send someone to their billing page to fix a rate limit. The
       provider's body is read for that one code and never forwarded: the error
       text is theirs, and it can name the account it came from. */
    const code = await readErrorCode(res);
    const error =
      res.status === 401
        ? "The API key was rejected."
        : res.status === 429
          ? code === "insufficient_quota"
            ? "Out of credit."
            : "Too many messages at once. Give it a moment."
          : "The mentor is unavailable right now.";
    return Response.json(
      { error },
      { status: res.status === 401 || res.status === 429 ? res.status : 502 },
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return Response.json({ error: "Unreadable reply." }, { status: 502 });
  }

  const reply = readText(parsed, message);
  if (!reply) return Response.json({ error: "Empty reply." }, { status: 502 });

  const result: Reply = reply.crisis
    ? { crisis: { crisis: true } }
    : { text: reply.text.slice(0, MAX_REPLY_CHARS) };

  return Response.json(result);
}

/**
 * Pulls the one code worth branching on out of a provider error.
 *
 * Consumes the body, so it is only ever called on the way out of a failure. A
 * body that is not the shape expected, or not JSON at all, is worth nothing and
 * is treated as no answer rather than guessed at.
 */
async function readErrorCode(res: Response): Promise<string> {
  try {
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== "object") return "";
    const err = (parsed as Record<string, unknown>).error;
    if (!err || typeof err !== "object") return "";
    const e = err as Record<string, unknown>;
    if (typeof e.code === "string") return e.code;
    return typeof e.type === "string" ? e.type : "";
  } catch {
    return "";
  }
}

/**
 * Self-harm or suicidal intent, in the user's own words.
 *
 * Every alternative here has to be a first-person construction aimed at the
 * speaker. Matching a bare "hurt" or "kill" would fire on a dislocated shoulder
 * and a horror film, and a mentor that answers a sprained ankle with a crisis
 * line is worse than useless — so the verb alone is never enough, it always has
 * to be pointed back at the person asking.
 *
 * It is also deliberately not exhaustive, which is what the second path below
 * is for.
 */
const DISTRESS = new RegExp(
  [
    String.raw`\b(kill|killing|hang|hanging|cut|cutting|end|ending|hurt|harming|harm)\s+(myself|my\s+own\s+life|my\s+life|it)\b`,
    String.raw`\bmy\s+own\s+life\s+(is|should\s+be)\s+(over|ended?|finished)\b`,
    String.raw`\bsuicid\w*`,
    String.raw`\bself[-\s]?harm\w*`,
    String.raw`\b(want|wants|wanted|wish|wishes|hoping|hope)\s+(to|i\s+want\s+to|i\s+could)\s+die\b`,
    String.raw`\bbetter\s+off\s+(dead|without\s+me)\b`,
    String.raw`\b(wish|wishes|wished)\s+i\s+(was|were)\s+dead\b`,
    String.raw`\bdon'?t\s+want\s+to\s+(live|be\s+alive|exist)\b`,
    String.raw`\bnot\s+(want|wanting|feel\s+like\s+wanting)\s+to\s+be\s+alive\b`,
    String.raw`\btake\s+my\s+own\s+life\b`,
    String.raw`\boverdos(e|ing|ed)\b`,
    String.raw`\bend\s+(it|things|my\s+life)\s+forever\b`,
    String.raw`\bcan'?t\s+go\s+on\b`,
    String.raw`\bno\s+reason\s+to\s+(live|go\s+on)\b`,
  ].join("|"),
  "i",
);

/**
 * The model talking about self-harm, whatever prompted it.
 *
 * This is the second and independent path, and it exists only to catch a
 * phrasing DISTRESS does not recognise. It has to name self-harm itself, and
 * this is the second bug this file has had, so the reason is worth writing down.
 *
 * The first version treated a handover as a crisis, matching "not the right
 * place", "988", "crisis line" and "emergency service" anywhere in the reply.
 * Those are the words the prompt tells the model to use when it refuses — for
 * *anything* it must not answer. Asked about a sore knee, the model correctly
 * declined to give a medical opinion and sent the user to a trusted adult, and
 * roughly half the time it did so with the word "place" in the sentence. Every
 * one of those replies was then thrown away and replaced with a suicide crisis
 * line and a 988 number, for a bad knee.
 *
 * So: declining is not the signal, and the words a refusal happens to use are
 * not the signal. The signal is the model putting suicide, self-harm, dying or
 * killing oneself into the reply. A reply that hands over without ever naming
 * any of those is a scope refusal, and its own text is the right thing to show —
 * it is what the model was asked to write, it routes the user to a real adult,
 * and it does not need to be replaced by anything.
 *
 * The failure this trades away is a genuine crisis phrased without a single one
 * of these words, which would be left to DISTRESS. That is the right way round:
 * the cost of missing one is a correct crisis answer reaching the user, and the
 * cost of the alternative was alarming a fifteen-year-old about suicide.
 */
const SELF_HARM =
  /\bsuicid\w*|\bself[-\s]?harm\w*|\bkill(ing)?\s+(my\s+own\s+)?life\b|\bkilling\s+myself\b|\bending\s+(my|it|things|things\s+forever)\b|\bend\s+my\s+life\b|\bwants?\s+to\s+die\b|\bwant(ing)?\s+to\s+be\s+dead\b|\bhurt(ing)?\s+myself\b|\bharm(ing)?\s+myself\b|\btaking?\s+my\s+own\s+life\b|\boverdos(e|ing|ed)\b|\bnot\s+want\w*\s+to\s+be\s+alive\b/i;

/**
 * Pulls the text out of a Responses API payload, and decides whether the model
 * has handed the conversation over.
 *
 * The decision is made here, on the server, so the discarded words never reach
 * the browser at all. It is not made by asking the model to flag its own output:
 * it is not trusted to be the judge of its own output, and the first version of
 * this check asked it to be one and therefore failed open on all three live
 * phrasings that were tested. See DISTRESS for what replaced it.
 */
function readText(parsed: unknown, said: string): { text: string; crisis: boolean } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const output = Array.isArray(o.output) ? o.output : [];
  const text = output
    .flatMap((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).content : null))
    .flatMap((c) => (c && typeof c === "object" ? [(c as Record<string, unknown>).text] : []))
    .filter(isStr)
    .join("")
    .trim();

  if (!text) return null;

  /* Two independent paths, either of which is enough. The user's own words are
     the reliable one; the model's own mention of self-harm is the backstop that
     catches a phrasing the first one does not know. A refusal on its own is not
     enough — see SELF_HARM. */
  return { text, crisis: DISTRESS.test(said) || SELF_HARM.test(text) };
}
