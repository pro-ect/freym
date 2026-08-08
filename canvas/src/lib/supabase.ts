import { createClient } from "@supabase/supabase-js";

// Shared freym/foto-room backend. Publishable key — safe to ship in the client.
const SUPABASE_URL = "https://lmuksetmkzssoewkzdlm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZYGneWC6-DF3rUhWKSZ9Mw_X961Xb_5";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { SUPABASE_URL };
