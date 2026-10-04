import type { DataProvider } from "../types";
import { SyncProvider } from "./sync";

/**
 * The swap point, as it was always meant to be.
 *
 * Synchronous and unconditional, which is the whole reason it looks this way: six
 * pages call getProvider().getToday(), and none of them should have to know that
 * which provider answers is a question about the database. SyncProvider decides for
 * itself — it holds no state and asks hasHealthData-shaped questions on every call,
 * so it serves real numbers the moment the phone's first sync lands and the mock
 * until then.
 *
 * Making this async instead would mean awaiting a provider at six call sites, and
 * the answer would still be "it depends on whether data has arrived", which is not
 * a decision a page should be making.
 */
export function getProvider(): DataProvider {
  return new SyncProvider();
}

export { MockProvider } from "./mock";
export { SyncProvider } from "./sync";