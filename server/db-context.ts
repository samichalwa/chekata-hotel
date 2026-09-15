import { AsyncLocalStorage } from "node:async_hooks";

// Which physical database a request/job is operating against. "live" is the
// real production database; "test" is the isolated clone used for training,
// demos, and QA without touching real guest/tenant/staff/financial data.
export type DbEnvironment = "live" | "test";

const storage = new AsyncLocalStorage<DbEnvironment>();

// Reads the environment for the currently-executing request/job. Falls back
// to "live" when no context has been established (startup scripts, cron
// jobs, the session store, and anything else that never opted into "test").
export function getCurrentEnvironment(): DbEnvironment {
  return storage.getStore() ?? "live";
}

// Runs `fn` with `env` bound as the current database environment for the
// whole duration of the (possibly async) call — including any awaited work
// inside it. This is how a single Express request gets routed to Live or
// Test for every storage call it makes, without threading a parameter
// through hundreds of existing function signatures.
export function runWithEnvironment<T>(env: DbEnvironment, fn: () => T): T {
  return storage.run(env, fn);
}
