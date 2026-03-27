-- ==========================
-- AFILIADOS (Betting) - Setup
-- ==========================
-- Rode esse SQL no Supabase (SQL Editor).
-- Ele cria tabelas essenciais + índices + sugestões de RLS.
-- Ajuste nomes/colunas se você já tem algo pronto.

-- 1) PROFILES (linka auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  role text not null default 'affiliate' check (role in ('affiliate','owner')),
  affiliate_code text unique,
  created_at timestamptz not null default now()
);

-- Se a tabela já existia (criada antes deste SQL), garanta as colunas necessárias.
alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists affiliate_code text;
alter table public.profiles add column if not exists created_at timestamptz;

-- Campos do cadastro (antes da aprovação)
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists instagram text;
alter table public.profiles add column if not exists whatsapp text;

-- Aprovação do afiliado (o gerente/owner aprova)
alter table public.profiles add column if not exists approval_status text not null default 'pending'
  check (approval_status in ('pending','approved','rejected'));
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid;
alter table public.profiles add column if not exists rejected_at timestamptz;
alter table public.profiles add column if not exists rejected_by uuid;

-- Campos de operação (config do afiliado + saldos de comissão)
alter table public.profiles add column if not exists casa_nome text;
alter table public.profiles add column if not exists casa_link text;
alter table public.profiles add column if not exists link_marcha text; -- link de afiliado (definido pelo owner)
alter table public.profiles add column if not exists comissao_modelo text;
alter table public.profiles add column if not exists baseline numeric(14,2);
alter table public.profiles add column if not exists cpa numeric(14,2);
alter table public.profiles add column if not exists rev numeric(14,2);

-- Saldos que o OWNER edita manualmente
alter table public.profiles add column if not exists commission_available numeric(14,2) not null default 0;
alter table public.profiles add column if not exists commission_requested numeric(14,2) not null default 0;
alter table public.profiles add column if not exists commission_paid numeric(14,2) not null default 0;
alter table public.profiles add column if not exists commission_refused numeric(14,2) not null default 0;

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role, affiliate_code, approval_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',''),
    new.email,
    'affiliate',
    new.id::text,
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 2) SOLICITAÇÕES DE AFILIAÇÃO
create table if not exists public.affiliate_applications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text,
  whatsapp text,
  channels text,
  experience text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  notes_admin text,
  created_at timestamptz not null default now()
);

-- 3) MÉTRICAS DIÁRIAS (AGREGADAS)
create table if not exists public.affiliate_stats_daily (
  id bigserial primary key,
  affiliate_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  signups int not null default 0,
  ftds int not null default 0,
  ftd_amount numeric(14,2) not null default 0,
  qftds_cpa int not null default 0,
  cpa_amount numeric(14,2) not null default 0,
  deposits_amount numeric(14,2) not null default 0,
  revshare_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists affiliate_stats_unique on public.affiliate_stats_daily (affiliate_id, day);

-- 4) LEDGER DE COMISSÕES (STATUS)
create table if not exists public.commissions_ledger (
  id bigserial primary key,
  affiliate_id uuid not null references public.profiles(id) on delete cascade,
  day date,
  type text not null check (type in ('revshare','cpa','adjustment')),
  amount numeric(14,2) not null default 0,
  status text not null default 'available' check (status in ('available','requested','paid','refused')),
  created_at timestamptz not null default now()
);

create index if not exists commissions_affiliate_idx on public.commissions_ledger (affiliate_id, status);

-- 5) SOLICITAÇÕES DE SAQUE
create table if not exists public.payout_requests (
  id bigserial primary key,
  affiliate_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(14,2) not null,
  method text,
  -- status:
  -- requested = em análise
  -- approved  = aprovado (com valor aprovado)
  -- paid      = pago
  -- refused   = recusado
  status text not null default 'requested' check (status in ('requested','approved','paid','refused')),
  -- Dados do saque (Pix)
  full_name text,
  cpf text,
  pix_key text,
  bank_name text,
  approved_amount numeric(14,2),
  admin_note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists payout_affiliate_idx on public.payout_requests (affiliate_id, status);

-- ==========================
-- RLS (Sugestão)
-- ==========================
alter table public.profiles enable row level security;
alter table public.affiliate_applications enable row level security;
alter table public.affiliate_stats_daily enable row level security;
alter table public.commissions_ledger enable row level security;
alter table public.payout_requests enable row level security;

-- helper: is owner?
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner'
  );
$$;


-- ==========================
-- ADMIN: Remover afiliado (apaga Auth + Profile)
-- ==========================
-- IMPORTANTE: isso remove o usuário de auth.users. O afiliado precisará criar conta de novo.
create or replace function public.admin_delete_affiliate(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
begin
  if not public.is_owner() then
    raise exception 'Apenas owner pode remover afiliados.';
  end if;

  -- Apaga do Auth (profiles e tabelas relacionadas caem via ON DELETE CASCADE)
  delete from auth.users where id = p_user_id;

  return true;
end;
$$;

grant execute on function public.admin_delete_affiliate(uuid) to authenticated;

-- PROFILES: usuário vê o próprio; owner vê todos
drop policy if exists "profiles_select_own_or_owner" on public.profiles;
create policy "profiles_select_own_or_owner"
on public.profiles for select
using (id = auth.uid() or public.is_owner());

-- Permite que o próprio usuário crie o seu profile (útil para usuários antigos / bootstrap no front)
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (id = auth.uid());

-- PROFILES UPDATE: somente OWNER pode alterar dados do perfil.
-- (Afiliado NÃO edita métricas, comissão, casa, link, etc.)
drop policy if exists "profiles_update_own_or_owner" on public.profiles;
drop policy if exists "profiles_update_owner" on public.profiles;
create policy "profiles_update_owner"
on public.profiles for update
using (public.is_owner())
with check (public.is_owner());

-- Afiliado pode completar o cadastro (apenas enquanto status = pending).
-- A proteção de colunas é feita por trigger (abaixo).
drop policy if exists "profiles_update_pending_self" on public.profiles;
create policy "profiles_update_pending_self"
on public.profiles for update
using (id = auth.uid() and approval_status = 'pending')
with check (id = auth.uid() and approval_status = 'pending');

-- Trigger de proteção: afiliado NÃO pode alterar campos sensíveis.
create or replace function public.protect_profile_update()
returns trigger as $$
begin
  -- OWNER pode tudo
  if public.is_owner() then
    return new;
  end if;

  -- Permitidos para o próprio afiliado (pendente): name, full_name, instagram, whatsapp
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
$$ language plpgsql security definer;

drop trigger if exists trg_protect_profile_update on public.profiles;
create trigger trg_protect_profile_update
before update on public.profiles
for each row execute procedure public.protect_profile_update();

-- APPLICATIONS: user cria e vê as próprias; owner vê tudo e atualiza status
drop policy if exists "apps_insert_own" on public.affiliate_applications;
create policy "apps_insert_own"
on public.affiliate_applications for insert
with check (user_id = auth.uid());

drop policy if exists "apps_select_own_or_owner" on public.affiliate_applications;
create policy "apps_select_own_or_owner"
on public.affiliate_applications for select
using (user_id = auth.uid() or public.is_owner());

drop policy if exists "apps_update_owner" on public.affiliate_applications;
create policy "apps_update_owner"
on public.affiliate_applications for update
using (public.is_owner())
with check (public.is_owner());

-- STATS: affiliate lê o próprio; owner lê/escreve tudo
drop policy if exists "stats_select_own_or_owner" on public.affiliate_stats_daily;
create policy "stats_select_own_or_owner"
on public.affiliate_stats_daily for select
using (affiliate_id = auth.uid() or public.is_owner());

drop policy if exists "stats_write_owner" on public.affiliate_stats_daily;
create policy "stats_write_owner"
on public.affiliate_stats_daily for insert
with check (public.is_owner());

drop policy if exists "stats_update_owner" on public.affiliate_stats_daily;
create policy "stats_update_owner"
on public.affiliate_stats_daily for update
using (public.is_owner())
with check (public.is_owner());

-- COMMISSIONS: affiliate lê o próprio; owner escreve
drop policy if exists "comm_select_own_or_owner" on public.commissions_ledger;
create policy "comm_select_own_or_owner"
on public.commissions_ledger for select
using (affiliate_id = auth.uid() or public.is_owner());

drop policy if exists "comm_write_owner" on public.commissions_ledger;
create policy "comm_write_owner"
on public.commissions_ledger for insert
with check (public.is_owner());

drop policy if exists "comm_update_owner" on public.commissions_ledger;
create policy "comm_update_owner"
on public.commissions_ledger for update
using (public.is_owner())
with check (public.is_owner());

-- PAYOUTS: affiliate lê e cria o próprio request; owner atualiza status
drop policy if exists "payout_select_own_or_owner" on public.payout_requests;
create policy "payout_select_own_or_owner"
on public.payout_requests for select
using (affiliate_id = auth.uid() or public.is_owner());

drop policy if exists "payout_insert_own" on public.payout_requests;
create policy "payout_insert_own"
on public.payout_requests for insert
with check (affiliate_id = auth.uid());

drop policy if exists "payout_update_owner" on public.payout_requests;
create policy "payout_update_owner"
on public.payout_requests for update
using (public.is_owner())
with check (public.is_owner());
