import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env-schema.js";

// Create Supabase client for backend operations (service role)
export const supabaseServiceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Create Supabase client for public operations (publishable key)
export const supabasePublicClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY);
