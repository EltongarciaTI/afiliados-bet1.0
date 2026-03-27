import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://jsnbcdhvzgoxcorkdscb.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzbmJjZGh2emdveGNvcmtkc2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MjUxMDMsImV4cCI6MjA4NzEwMTEwM30.FxpsXz1rHAcf_7tEnU5a6skUqUJHEItCxH0vWaTsV5M";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
