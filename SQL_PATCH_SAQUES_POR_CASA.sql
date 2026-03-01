-- SQL_PATCH_SAQUES_POR_CASA.sql
-- Habilita saque por casa (cada casa tem sua própria comissão)
-- Rode no Supabase (SQL Editor) como owner.

alter table public.payout_requests
  add column if not exists house_id uuid,
  add column if not exists house_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payout_requests_house_id_fkey'
  ) then
    alter table public.payout_requests
      add constraint payout_requests_house_id_fkey
      foreign key (house_id) references public.houses(id) on delete set null;
  end if;
end $$;

create index if not exists payout_requests_house_id_idx
  on public.payout_requests (house_id);
