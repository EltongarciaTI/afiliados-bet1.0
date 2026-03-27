-- SQL_PLATAFORMAS_REQUESTS.sql
-- Plataformas (catálogo de casas) + solicitações de afiliação
-- Rode no Supabase (SQL Editor)

-- 1) Catálogo de casas (admin cadastra as plataformas disponíveis)
create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  link text,
  comissao_modelo text not null default 'cpa',  -- 'cpa' | 'rev' | 'hibrido'
  baseline numeric not null default 0,
  cpa numeric not null default 0,
  rev numeric not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Se a tabela já existia (de outra versão), garanta as colunas esperadas pelo painel.
alter table public.houses add column if not exists nome text;
alter table public.houses add column if not exists link text;
alter table public.houses add column if not exists comissao_modelo text;
alter table public.houses add column if not exists baseline numeric;
alter table public.houses add column if not exists cpa numeric;
alter table public.houses add column if not exists rev numeric;
alter table public.houses add column if not exists ativo boolean;
alter table public.houses add column if not exists created_at timestamptz;

-- defaults (caso colunas antigas estejam sem default)
alter table public.houses alter column comissao_modelo set default 'cpa';
alter table public.houses alter column baseline set default 0;
alter table public.houses alter column cpa set default 0;
alter table public.houses alter column rev set default 0;
alter table public.houses alter column ativo set default true;
alter table public.houses alter column created_at set default now();

create index if not exists houses_ativo_idx on public.houses(ativo);

alter table public.houses enable row level security;

-- Owner: controle total
drop policy if exists owner_full_access_houses on public.houses;
create policy owner_full_access_houses
on public.houses
for all
using (public.is_owner_db(auth.uid()))
with check (public.is_owner_db(auth.uid()));

-- Afiliado: pode ver apenas casas ativas
-- (o admin também enxerga por causa da policy owner)
drop policy if exists houses_select_active on public.houses;
create policy houses_select_active
on public.houses
for select
using (ativo = true);

-- 2) Solicitações de afiliação por casa (afiliado solicita / admin aprova)
create table if not exists public.affiliate_house_requests (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.profiles(id) on delete cascade,
  house_name text not null,
  house_link text,
  status text not null default 'pending', -- pending | approved | rejected
  created_at timestamptz not null default now()
);

create index if not exists ahr_affiliate_idx on public.affiliate_house_requests(affiliate_id);
create index if not exists ahr_status_idx on public.affiliate_house_requests(status);

alter table public.affiliate_house_requests enable row level security;

-- Affiliate: pode criar e ver apenas suas solicitações
drop policy if exists ahr_select_own on public.affiliate_house_requests;
create policy ahr_select_own
on public.affiliate_house_requests
for select
using (affiliate_id = auth.uid());

drop policy if exists ahr_insert_own on public.affiliate_house_requests;
create policy ahr_insert_own
on public.affiliate_house_requests
for insert
with check (affiliate_id = auth.uid());

-- Owner: vê tudo e pode aprovar/recusar
drop policy if exists ahr_owner_all on public.affiliate_house_requests;
create policy ahr_owner_all
on public.affiliate_house_requests
for all
using (public.is_owner_db(auth.uid()))
with check (public.is_owner_db(auth.uid()));
