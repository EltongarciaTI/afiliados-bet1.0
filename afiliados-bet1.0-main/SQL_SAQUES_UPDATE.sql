-- ==========================
-- UPDATE: SAQUES (payout_requests)
-- Roda este SQL se sua tabela payout_requests já existe.
-- ==========================

-- 1) Adicionar colunas necessárias (se já existirem, o IF NOT EXISTS evita erro)
alter table public.payout_requests
  add column if not exists full_name text,
  add column if not exists cpf text,
  add column if not exists pix_key text,
  add column if not exists bank_name text,
  add column if not exists approved_amount numeric(14,2);

-- 2) Atualizar o CHECK do status para incluir 'approved'
-- (precisa dropar o constraint antigo e criar de novo)
DO $$
BEGIN
  -- tenta remover qualquer constraint de check existente no campo status
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'payout_requests'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  ) THEN
    -- remove o constraint conhecido do setup antigo, se existir
    BEGIN
      alter table public.payout_requests drop constraint if exists payout_requests_status_check;
    EXCEPTION WHEN others THEN
      -- se tiver nome diferente, ignore (vamos criar o novo abaixo)
      NULL;
    END;
  END IF;
END $$;

-- Cria/garante o novo constraint (nome fixo)
alter table public.payout_requests
  drop constraint if exists payout_requests_status_check;

alter table public.payout_requests
  add constraint payout_requests_status_check
  check (status in ('requested','approved','paid','refused'));

-- 3) (Opcional) Índice para admin filtrar rápido
create index if not exists payout_status_created_idx
  on public.payout_requests (status, created_at desc);
