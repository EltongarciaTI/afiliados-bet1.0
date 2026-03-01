-- Afiliados Bet Vini | MULTI-CASAS + PERFIL COMPLETO
-- Rode este SQL no Supabase (SQL Editor) como owner.
-- Objetivo:
-- 1) Tabela affiliate_houses (múltiplas casas por afiliado)
-- 2) Campos extras em profiles para guardar dados do cadastro (sempre visíveis no admin)
-- 3) RLS: afiliado só lê seus dados; owner controla tudo.

-- =========================
-- 0) Campos extras do cadastro (profiles)
-- =========================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram text,
  ADD COLUMN IF NOT EXISTS experience text,
  ADD COLUMN IF NOT EXISTS notes text;

-- =========================
-- 1) Tabela: affiliate_houses
-- =========================
CREATE TABLE IF NOT EXISTS public.affiliate_houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  house_name text NOT NULL,
  house_link text,
  affiliate_link text,

  comissao_modelo text NOT NULL DEFAULT 'cpa' CHECK (comissao_modelo in ('cpa','rev','hibrido')),
  baseline numeric NOT NULL DEFAULT 0,
  cpa numeric NOT NULL DEFAULT 0,
  rev numeric NOT NULL DEFAULT 0,

  commission_available numeric NOT NULL DEFAULT 0,
  commission_requested numeric NOT NULL DEFAULT 0,
  commission_paid numeric NOT NULL DEFAULT 0,
  commission_refused numeric NOT NULL DEFAULT 0,

  -- Métricas (totais por casa). Simples e totalmente controlado pelo admin.
  total_signups integer NOT NULL DEFAULT 0,
  total_ftds integer NOT NULL DEFAULT 0,
  total_deposits_amount numeric NOT NULL DEFAULT 0,
  total_cpa_amount numeric NOT NULL DEFAULT 0,
  total_revshare_amount numeric NOT NULL DEFAULT 0,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_houses_affiliate_id_idx
  ON public.affiliate_houses (affiliate_id);

-- updated_at auto
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_affiliate_houses_updated_at ON public.affiliate_houses;
CREATE TRIGGER trg_affiliate_houses_updated_at
BEFORE UPDATE ON public.affiliate_houses
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- 2) RLS / Policies
-- =========================
ALTER TABLE public.affiliate_houses ENABLE ROW LEVEL SECURITY;

-- Afiliado pode apenas LER suas próprias casas
DROP POLICY IF EXISTS affiliate_houses_select_own ON public.affiliate_houses;
CREATE POLICY affiliate_houses_select_own
ON public.affiliate_houses
FOR SELECT
USING (affiliate_id = auth.uid());

-- Owner: controle total
-- (Assume que você já tem a função is_owner_db(uid) funcionando no seu banco.)
DROP POLICY IF EXISTS owner_full_access_affiliate_houses ON public.affiliate_houses;
CREATE POLICY owner_full_access_affiliate_houses
ON public.affiliate_houses
FOR ALL
USING (is_owner_db(auth.uid()))
WITH CHECK (is_owner_db(auth.uid()));

-- Profiles: owner consegue ver tudo; afiliado vê o próprio
-- (Se você já tem policies, ignore/ajuste conforme necessário.)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
ON public.profiles
FOR SELECT
USING (id = auth.uid() OR is_owner_db(auth.uid()));

DROP POLICY IF EXISTS profiles_update_own_limited ON public.profiles;
CREATE POLICY profiles_update_own_limited
ON public.profiles
FOR UPDATE
USING (id = auth.uid() OR is_owner_db(auth.uid()))
WITH CHECK (id = auth.uid() OR is_owner_db(auth.uid()));

-- ⚠️ Recomendação:
-- Afiliado NÃO deve conseguir editar commission_* nem campos de config.
-- Se quiser travar totalmente, remova UPDATE para afiliado e permita somente owner.
-- Exemplo (opcional):
-- DROP POLICY profiles_update_own_limited ON public.profiles;
-- CREATE POLICY profiles_update_owner_only
-- ON public.profiles
-- FOR UPDATE
-- USING (is_owner_db(auth.uid()))
-- WITH CHECK (is_owner_db(auth.uid()));
