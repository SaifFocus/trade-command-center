// Logs one run of a background job for the Agents page (desk_agent_runs via desk_log_agent_run).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { errorNote, summarizeRun, type RunNote } from "./agents";

type DB = SupabaseClient<Database>;

/** Runs `job` and logs its outcome under the agent `key`. A failed log never fails the job; a failed job is logged
 * as an error and rethrown. */
export async function recordRun<T>(db: DB, key: string, job: () => Promise<T>): Promise<T> {
  const started = new Date().toISOString();
  let out: T;
  try {
    out = await job();
  } catch (e) {
    await logRun(db, key, errorNote(e), started);
    throw e;
  }
  await logRun(db, key, summarizeRun(key, out), started);
  return out;
}

async function logRun(db: DB, key: string, note: RunNote, started: string) {
  try {
    const { error } = await db.rpc("desk_log_agent_run", {
      p_agent_key: key,
      p_status: note.status,
      p_summary: note.summary,
      p_items: note.items,
      p_started_at: started,
    });
    if (error) console.error(`agent run log (${key}): ${error.message}`);
  } catch (e) {
    console.error(`agent run log (${key}):`, e);
  }
}
