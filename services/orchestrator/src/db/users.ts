import { db } from "./client.js";

export interface UserRecord {
  id: string;
  workos_id: string;
  email: string;
  display_name: string | null;
}

/**
 * Look up a user by their WorkOS ID; create the row if it doesn't exist.
 * Called on every authenticated WS connection.
 */
export async function upsertUser(input: {
  workos_id: string;
  email: string;
  display_name?: string | null;
}): Promise<UserRecord> {
  const { data, error } = await db()
    .from("users")
    .upsert(
      {
        workos_id: input.workos_id,
        email: input.email,
        display_name: input.display_name ?? null,
      },
      { onConflict: "workos_id" },
    )
    .select("id, workos_id, email, display_name")
    .single();

  if (error || !data) {
    throw new Error(`upsertUser failed: ${error?.message ?? "no row returned"}`);
  }
  return data as UserRecord;
}
