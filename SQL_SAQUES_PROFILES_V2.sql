-- =========================================================
-- SAQUES (PERFIL) — V2 (sem casas) — Afiliados Bet
--
-- Objetivo:
-- - Dashboard e Saque usam as mesmas colunas em public.profiles:
--     commission_available, commission_requested, commission_paid, commission_refused
-- - Afiliado solicita saque: available -> requested (ATÔMICO) + cria payout_requests status='requested'
-- - Admin paga: requested -> paid (com fallback para casos antigos)
-- - Admin recusa: requested -> available + refused
--
-- Por que V2?
-- - Para evitar conflito com funções antigas (overloads) que podem existir no banco
--   e causar erro 22P02 (UUID). O front chama request_payout_profile_v2.
--
-- Rode este arquivo inteiro no Supabase (SQL Editor).
-- =========================================================

-- 1) Trigger guard: libera atualização de commission_* quando vier de RPC (flag)
create or replace function public.protect_profile_update()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- ✅ PERMITIR QUANDO VIER DE RPC
  if current_setting('app.allow_commission_update', true) = '1' then
    return new;
  end if;

  -- OWNER pode tudo
  if public.is_owner() then
    return new;
  end if;

  if new.id <> auth.uid() then
    raise exception 'forbidden';
  end if;

  -- Bloqueia alteração de campos sensíveis
  if (new.role is distinct from old.role)
    or (new.affiliate_code is distinct from old.affiliate_code)
    or (new.approval_status is distinct from old.approval_status)
    or (new.approved_at is distinct from old.approved_at)
    or (new.approved_by is distinct from old.approved_by)
    or (new.rejected_at is distinct from old.rejected_at)
    or (new.rejected_by is distinct from old.rejected_by)
    or (new.casa_nome is distinct from old.casa_nome)
    or (new.casa_link is distinct from old.casa_link)
    or (new.link_marcha is distinct from old.link_marcha)
    or (new.comissao_modelo is distinct from old.comissao_modelo)
    or (new.baseline is distinct from old.baseline)
    or (new.cpa is distinct from old.cpa)
    or (new.rev is distinct from old.rev)
    or (new.commission_available is distinct from old.commission_available)
    or (new.commission_requested is distinct from old.commission_requested)
    or (new.commission_paid is distinct from old.commission_paid)
    or (new.commission_refused is distinct from old.commission_refused)
  then
    raise exception 'Você não tem permissão para alterar esses campos.';
  end if;

  return new;
end;
$function$;

-- 2) payout_requests: se existir house_id/house_name, deixa NULL (não usamos casas)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payout_requests' and column_name='house_id'
  ) then
    execute 'alter table public.payout_requests alter column house_id drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payout_requests' and column_name='house_name'
  ) then
    execute 'alter table public.payout_requests alter column house_name drop not null';
  end if;
end $$;

-- 3) CHECK status (se não existir)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payout_requests_status_check'
      and conrelid = 'public.payout_requests'::regclass
  ) then
    alter table public.payout_requests
      add constraint payout_requests_status_check
      check ((status = any (array['requested'::text,'approved'::text,'paid'::text,'refused'::text])));
  end if;
end $$;

-- 4) RPC V2: afiliado solicita saque (available -> requested) + cria payout requested
create or replace function public.request_payout_profile_v2(
  p_amount numeric,
  p_full_name text,
  p_cpf text,
  p_pix_key text,
  p_bank_name text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_avail numeric;
  v_payout_id bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Valor inválido';
  end if;

  select coalesce(commission_available,0)
    into v_avail
  from profiles
  where id = v_uid
  for update;

  if v_avail < p_amount then
    raise exception 'Saldo indisponível';
  end if;

  -- ✅ bypass do trigger de proteção
  perform set_config('app.allow_commission_update', '1', true);

  update profiles
  set
    commission_available = coalesce(commission_available,0) - p_amount,
    commission_requested = coalesce(commission_requested,0) + p_amount
  where id = v_uid;

  insert into payout_requests (
    affiliate_id, amount, full_name, cpf, pix_key, bank_name, status
  ) values (
    v_uid, p_amount, p_full_name, p_cpf, p_pix_key, p_bank_name, 'requested'
  )
  returning id into v_payout_id;

  return v_payout_id;
end;
$$;

grant execute on function public.request_payout_profile_v2(numeric,text,text,text,text) to authenticated;

-- 5) RPC: admin finaliza saque (paid/refused) mexendo no profiles
create or replace function public.finalize_payout_profile(
  p_payout_id bigint,
  p_new_status text,
  p_approved_amount numeric default null,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aff uuid;
  v_amount numeric;
  v_new text;
  v_appr numeric;
  v_req numeric;
  v_avail numeric;
  v_take_from_req numeric;
  v_take_from_avail numeric;
begin
  if not public.is_owner() then
    raise exception 'forbidden';
  end if;

  v_new := lower(coalesce(p_new_status,''));
  if v_new not in ('approved','paid','refused','requested') then
    raise exception 'Status inválido';
  end if;

  select affiliate_id, amount
    into v_aff, v_amount
  from payout_requests
  where id = p_payout_id
  for update;

  if v_aff is null then
    raise exception 'Saque não encontrado';
  end if;

  v_appr := coalesce(p_approved_amount, v_amount);

  update payout_requests
  set
    status = v_new,
    approved_amount = p_approved_amount,
    admin_note = p_admin_note,
    processed_at = case when v_new in ('paid','refused') then now() else processed_at end
  where id = p_payout_id;

  select coalesce(commission_requested,0), coalesce(commission_available,0)
    into v_req, v_avail
  from profiles
  where id = v_aff
  for update;

  perform set_config('app.allow_commission_update', '1', true);

  if v_new = 'paid' then
    -- consome requested; se faltar (casos antigos), consome available
    v_take_from_req := least(v_req, v_amount);
    v_take_from_avail := greatest(0, v_amount - v_take_from_req);

    if v_take_from_avail > v_avail then
      raise exception 'Saldo inconsistente: available insuficiente';
    end if;

    update profiles
    set
      commission_requested = greatest(0, coalesce(commission_requested,0) - v_take_from_req),
      commission_available = greatest(0, coalesce(commission_available,0) - v_take_from_avail),
      commission_paid = coalesce(commission_paid,0) + v_appr
    where id = v_aff;

  elsif v_new = 'refused' then
    v_take_from_req := least(v_req, v_amount);

    update profiles
    set
      commission_requested = greatest(0, coalesce(commission_requested,0) - v_take_from_req),
      commission_available = coalesce(commission_available,0) + v_take_from_req,
      commission_refused = coalesce(commission_refused,0) + v_take_from_req
    where id = v_aff;
  end if;
end;
$$;

grant execute on function public.finalize_payout_profile(uuid,text,numeric,text) to authenticated;

-- 6) Policies recomendadas para payout_requests (afiliado cria/visualiza o próprio)
alter table public.payout_requests enable row level security;

drop policy if exists affiliate_insert_own_payout on public.payout_requests;
create policy affiliate_insert_own_payout
on public.payout_requests
for insert
to authenticated
with check (affiliate_id = auth.uid());

drop policy if exists affiliate_read_own_payout on public.payout_requests;
create policy affiliate_read_own_payout
on public.payout_requests
for select
to authenticated
using (affiliate_id = auth.uid());

-- Owner enxerga tudo (se já tiver policy semelhante, pode ignorar)
drop policy if exists owner_full_access_payouts on public.payout_requests;
create policy owner_full_access_payouts
on public.payout_requests
for all
to authenticated
using (public.is_owner())
with check (public.is_owner());
