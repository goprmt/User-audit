import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Service-role client — bypasses RLS.
 * With Clerk handling authentication, all DB access goes through
 * the service-role client. Access control is enforced in the API
 * layer via requireAuth / requireTenantAccess.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceKey
);
