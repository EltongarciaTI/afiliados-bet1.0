// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DO SUPABASE
// Copie este arquivo para clienteSupabase.js e preencha com suas credenciais.
// O arquivo clienteSupabase.js está no .gitignore e NÃO deve ser commitado.
//
// Onde encontrar:
//   Supabase Dashboard → Settings → API
//   → Project URL  (SUPABASE_URL)
//   → anon / public (SUPABASE_ANON_KEY)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://SEU_PROJETO.supabase.co";

export const SUPABASE_ANON_KEY = "SUA_ANON_KEY_AQUI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
