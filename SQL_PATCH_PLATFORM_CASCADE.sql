-- SQL_PATCH_PLATFORM_CASCADE.sql
-- Adiciona house_id nas tabelas de vínculo/solicitação e cria FK com ON DELETE CASCADE
-- Rode no Supabase (SQL Editor) como owner.

-- 1) affiliate_houses: house_id (FK -> houses)
alter table public.affiliate_houses
  add column if not exists house_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_houses_house_id_fkey'
  ) then
    alter table public.affiliate_houses
      add constraint affiliate_houses_house_id_fkey
      foreign key (house_id) references public.houses(id) on delete cascade;
  end if;
end $$;

create index if not exists affiliate_houses_house_id_idx
  on public.affiliate_houses (house_id);

-- 2) affiliate_house_requests: house_id (FK -> houses)
alter table public.affiliate_house_requests
  add column if not exists house_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_house_requests_house_id_fkey'
  ) then
    alter table public.affiliate_house_requests
      add constraint affiliate_house_requests_house_id_fkey
      foreign key (house_id) references public.houses(id) on delete cascade;
  end if;
end $$;

create index if not exists ahr_house_id_idx
  on public.affiliate_house_requests (house_id);

-- 3) Backfill simples (tenta casar por nome)
update public.affiliate_house_requests r
set house_id = h.id
from public.houses h
where r.house_id is null and lower(r.house_name) = lower(h.nome);

update public.affiliate_houses ah
set house_id = h.id
from public.houses h
where ah.house_id is null and lower(ah.house_name) = lower(h.nome);
