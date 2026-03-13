import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Public (anon) client — respects RLS.
 * Use for operations on behalf of an authenticated user
 * by passing the user's JWT via supabaseAnon.auth.setSession().
 */
export const supabaseAnon: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey
);

/**
 * Service-role client — bypasses RLS.
 * Use ONLY for server-side admin tasks (cron jobs, migrations)
 * where there is no user session.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceKey
);

/**
 * Create a Supabase client scoped to a specific user's session.
 * This client respects RLS and is bound to the user's JWT.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
