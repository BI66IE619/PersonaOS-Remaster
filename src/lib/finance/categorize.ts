/**
 * Assigns an app category to a bank transaction from its payee string.
 *
 * Rules rather than a model, deliberately. This runs inside the sync path, and a
 * model call there would mean sending every transaction description to a third
 * party on each sync, adding latency, cost, and a failure mode where the ledger
 * does not save because categorisation did. A rule set is deterministic, free,
 * offline, and its mistakes are inspectable.
 *
 * Order matters: the first matching rule wins, so specific merchants are listed
 * before the broad keyword passes, otherwise "Roblox" inside a generic pattern
 * would never be reached.
 *
 * Matching is case-insensitive substring on the payee as the bank wrote it. Banks
 * uppercase everything and mangle a lot ("POS PURCHASE", "SQ *COFFEE SHOP"), which
 * is why the patterns below are written against fragments rather than whole names.
 */

/** Expense categories, keyed by the ids in seed.ts CATEGORIES. */
const RULES: { id: string; any: string[] }[] = [
  /* Subscriptions and software first. Several of these also read as "other" to a
     generic pass, and a subscription miscategorised as Other is worse than one
     miscategorised as a subscription, because it hides from the recurring view.

     Game stores are deliberately absent even where they sell subscriptions —
     "steam" and "playstation" are overwhelmingly game purchases, and listing them
     here would win on order and file every game under Subscriptions. */
  {
    id: "subs",
    any: [
      "netflix", "spotify", "hulu", "disney+", "disney plus", "apple.com/bill", "itunes",
      "apple music", "icloud", "google storage", "dropbox", "adobe", "microsoft", "msft",
      "github", "openai", "chatgpt", "anthropic", "claude", "opencode", "notion", "figma",
      "amazon prime", "audible", "kindle", "patreon", "substack", "linkedin premium",
      "onlyfans", "canva", "grammarly", "1password", "lastpass", "express vpn", "nordvpn",
    ],
  },

  /* Food before transport, because several coffee chains and convenience stores
     read as transport to a loose "fuel" pattern. */
  {
    id: "food",
    any: [
      "starbucks", "dunkin", "peet's", "peets", "coffee", "espresso", "cafe", "café",
      "mcdonald", "burger", "wendy", "taco", "chipotle", "subway", "panera", "starbucks",
      "raising cane", "cane's", "wetzel", "pretzel", "chick-fil-a", "popeyes", "kfc",
      "pizza", "papa john", "domino", "dominos", "pizza hut", "little caesars",
      "restaurant", "grill", "kitchen", "diner", "bistro", "taqueria", "sushi", "ramen",
      "noodle", "thai", "chinese", "mexican", "bakery", "donut", "doughnut", "bagel",
      "grocery", "groceries", "kroger", "aldi", "publix", "wegmans", "safeway", "trader joe",
      "whole foods", "costco", "sams club",
      /* Deliberately not walmart or target: they sell groceries but most of their
         spend is general merchandise, and a general store filed under Food is a
         number the user cannot reconcile against their statement. */
      "7-eleven", "7 eleven", "circle k", "wawa", "sheetz", "quiktrip",
      "food", "snack", "lunch", "dinner", "breakfast", "brunch", "deli",
      "doordash", "ubereats", "grubhub", "seamless", "instacart", "skip the dishes",
    ],
  },

  {
    id: "transport",
    any: [
      "uber", "lyft", "doordash*transit", "transit", "metro", "subway fare", "bus pass",
      "bus fare", "train", "amtrak", "caltrain", "mbta", "bart", "cta", "wmata",
      "parking", "toll", "fuel", "gas station", "gasoline", "petrol", "shell", "chevron",
      "exxon", "mobil", "bp ", "texaco", "citgo", "sunoco", "valero", "arco", "speedway",
      "car wash", "autozone", "o'reilly auto", "napa auto", "advance auto", "dmv",
      "rideshare", "taxi", "cab ", "yellow cab", "zipcar", "car2go",
    ],
  },

  {
    id: "games",
    any: [
      "roblox", "steam", "steampowered", "epic games", "playstation", "psn", "xbox",
      "nintendo", "eshop", "game stop", "gamestop", "riot games", "blizzard", "warcraft",
      "diablo", "overwatch", "valorant", "fortnite", "minecraft", "pokemon", "twitch",
      "patreon game", "kappa", "discord nitro", "skullcandy", "dice",
    ],
  },

  {
    id: "school",
    any: [
      "university", "college", "tuition", "campus", "bookstore", "textbook", "tuition",
      "udemy", "coursera", "duolingo", "school", "course", "khan", "brilliant",
      "quizlet", "chegg", "tutoring", "academy", "harvard", "mit", "stanford",
    ],
  },

  {
    id: "health",
    any: [
      "pharmacy", "cvs", "walgreens", "rite aid", "riteaid", "gym", "fitness", "planet fit",
      "la fitness", "crunch fitness", "yoga", "pilates", "crossfit", "doctor", "dental",
      "dentist", "optometr", "clinic", "hospital", "urgent care", "therapy", "therapist",
      "mental health", "betterhelp", "talkspace", "medical", "wellness",
      "massage", "chiropract", "physical therapy", "goodrx", "hims",
      /* Not "ro": two letters matches "Frontier", "Corner" and most other words
         ending in it. Not "cvs" on its own either — same reason. */
    ],
  },

  {
    id: "clothes",
    any: [
      "nike", "adidas", "under armour", "lululemon", "patagonia", "north face", "rei",
      "gap", "old navy", "h&m", "zara", "uniqlo", "forever 21", "american eagle",
      "express clothing", "macy", "nordstrom", "target apparel", "apparel", "clothing",
      "shoes", "footwear", "steve madden", "nike direct", "fashion", "boutique",
      "sephora", "ulta", "bath & body", "bath and body",
    ],
  },
];

/**
 * Income, kept separate because it must not land in an expense bucket.
 *
 * A negative amount is always a spend no matter what it says, so income is only
 * consulted for positive amounts. That ordering matters: a refund from a shop in
 * the food rules is money coming back, not a food expense.
 */
const INCOME_RULES = [
  "deposit", "payroll", "paycheck", "direct deposit", "salary", "wages", "interest",
  "dividend", "refund", "reimbursement", "rebate", "cashback", "cash back", "transfer in",
  "venmo", "zelle", "cashapp", "cash app", "paypal", "payout", "bonus", "tax refund",
  "insurance refund", "cashier", "atm deposit",
];

/**
 * The category for one transaction.
 *
 * Returns null when nothing matches, which is a legitimate outcome: the caller
 * stores null and the row lands in "other". Guessing is worse than admitting
 * ignorance — a wrong category confidently displayed is harder to notice than a
 * visible "Other" bucket, and harder to correct later.
 */
export function categorize(
  note: string,
  amountCents: number,
): string | null {
  const haystack = (note ?? "").toLowerCase();

  /* Empty strings would match nothing anyway, but returning early keeps the
     negative-amount rule readable and makes the no-information case explicit. */
  if (!haystack.trim()) return null;

  /* Money coming in. Checked first and only for positive amounts, so a refund of
     a grocery purchase counts as income rather than negative groceries. */
  if (amountCents > 0 && INCOME_RULES.some((k) => haystack.includes(k))) {
    return "job";
  }

  for (const rule of RULES) {
    if (rule.any.some((k) => haystack.includes(k))) return rule.id;
  }

  return null;
}

/** The category ids this module can produce, for validating stored rows. */
export const ASSIGNABLE = [
  ...RULES.map((r) => r.id),
  "job",
  "other",
] as const;