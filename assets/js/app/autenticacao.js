import { supabase } from "./clienteSupabase.js";


export async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session?.user || null;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      `id, name, full_name, instagram, whatsapp,
       email, role, affiliate_code,
       approval_status, approved_at, rejected_at,
       casa_nome, casa_link, link_marcha, comissao_modelo, baseline, cpa, rev,
       commission_available, commission_requested, commission_paid, commission_refused`
    )
    .eq("id", userId)
    .maybeSingle();

  // maybeSingle() returns null data when no rows. Treat as "no profile yet".
  if (error) throw error;
  return data || null;
}

export async function garantirProfile(user) {
  // tenta ver se profile existe
  const { data: p, error: e1 } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (e1) throw e1;

  // Se não existe, cria um profile mínimo.
  // IMPORTANTE: role="affiliate" APENAS na criação.
  // Assim um usuário owner não é sobrescrito por engano.
  if (!p) {
    const { error: e2 } = await supabase.from("profiles").insert({
      id: user.id,
      email: user.email,
      name: user.email ? user.email.split("@")[0] : null,
      role: "affiliate",
      affiliate_code: user.id,
    });
    if (e2) throw e2;
  }
}


async function bootstrapProfile(user) {
  // Fallback (caso policy permita) para criar profile do usuário.
  // ⚠️ Nunca sobrescreva `role` aqui. Senão um owner pode virar affiliate.
  const payload = {
    id: user.id,
    email: user.email,
    name: user.email ? user.email.split("@")[0] : null,
    affiliate_code: user.id,
  };

  // `ignoreDuplicates: true` faz o upsert virar "insert se não existir".
  // Assim não alteramos um profile existente.
  const { error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function exigirLogin(redirectTo = "entrar.html") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    window.location.href = redirectTo;
    return null;
  }
  return data.session.user;
}


export async function signInWithEmailPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmailPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requireAuth(opts = {}) {
  const { role } = opts;

  const { data, error } = await supabase.auth.getSession();
  if (error) return { ok: false, error };
  const user = data?.session?.user;
  if (!user) return { ok: false };

  // garante que existe profile
  try {
    await garantirProfile(user);
  } catch (e) {
    // fallback: tenta bootstrap via upsert (caso policy permita)
    try { await bootstrapProfile(user); } catch {}
  }

  const profile = await getProfile(user.id);

  if (role && profile?.role !== role) {
    return { ok: false, user, profile, forbidden: true };
  }

  return { ok: true, user, profile };
}