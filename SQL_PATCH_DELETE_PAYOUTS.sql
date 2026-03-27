-- SQL_PATCH_DELETE_PAYOUTS.sql
-- Soft delete de saques no admin (sem quebrar totais) + rollback se ainda estiver em análise

alter table public.payout_requests
  add column if not exists deleted_at timestamptz;

create or replace function public.soft_delete_payout(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  r record;
begin
  -- valida owner (mesma lógica do seu projeto)
  select (exists(select 1 from public.profiles p where p.id = v_uid and p.role = 'owner')) into v_is_owner;
  if not v_is_owner then
    raise exception 'not owner';
  end if;

  select * into r from public.payout_requests where id = p_payout_id;
  if not found then return; end if;

  -- Se ainda está em análise/solicitado/aprovado, desfaz comissão: solicitado -> disponível
  if lower(coalesce(r.status,'')) in ('requested','approved') then
    update public.affiliate_houses
      set commission_available = greatest(0, coalesce(commission_available,0) + coalesce(r.amount,0)),
          commission_requested = greatest(0, coalesce(commission_requested,0) - coalesce(r.amount,0))
    where id = r.house_id;
  end if;

  update public.payout_requests
    set deleted_at = now()
  where id = p_payout_id;
end;
$$;

-- Permissões: permitir executar para authenticated (RLS não afeta SECURITY DEFINER)
grant execute on function public.soft_delete_payout(uuid) to authenticated;
