-- SQL_PATCH_SAQUE_ATOMICO.sql
-- Objetivo: impedir que o afiliado consiga solicitar saque repetidas vezes com o mesmo saldo.
-- Faz o pedido de saque + movimentação de comissão (Disponível -> Solicitado) de forma atômica.
-- Também cria um RPC para o admin finalizar (Pago/Recusado) movimentando Solicitado -> Pago ou Solicitado -> Disponível.

begin;

-- Remove constraint antigo que costuma conflitar
alter table public.payout_requests
  drop constraint if exists payout_status_check;

-- Garante o CHECK correto do status (requested/approved/paid/refused)
alter table public.payout_requests
  drop constraint if exists payout_requests_status_check;

alter table public.payout_requests
  add constraint payout_requests_status_check
  check (status = any (array['requested','approved','paid','refused']));

-- Função: afiliado solicita saque (atômico)
create or replace function public.request_payout(
  p_house_id uuid,
  p_amount numeric,
  p_full_name text,
  p_cpf text,
  p_pix_key text,
  p_bank_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_house_name text;
  v_pid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

  -- Bypass RLS dentro da função (executa como owner)
  perform set_config('row_security','off', true);

  -- valida casa e pega nome
  select house_name into v_house_name
  from public.affiliate_houses
  where id = p_house_id
    and affiliate_id = v_uid
    and is_active = true
  for update;

  if not found then
    raise exception 'House not found';
  end if;

  -- Move saldo: Disponível -> Solicitado (com trava e regra de saldo)
  update public.affiliate_houses
  set commission_available = commission_available - p_amount,
      commission_requested = commission_requested + p_amount
  where id = p_house_id
    and affiliate_id = v_uid
    and is_active = true
    and commission_available >= p_amount;

  if not found then
    raise exception 'Saldo indisponível';
  end if;

  insert into public.payout_requests(
    affiliate_id, house_id, house_name,
    amount, status,
    full_name, cpf, pix_key, bank_name
  )
  values (
    v_uid, p_house_id, v_house_name,
    p_amount, 'requested',
    p_full_name, p_cpf, p_pix_key, p_bank_name
  )
  returning id into v_pid;

  return v_pid;
end;
$$;

grant execute on function public.request_payout(uuid, numeric, text, text, text, text) to authenticated;

-- Função: admin finaliza saque (Pago/Recusado) e movimenta comissões
create or replace function public.finalize_payout(
  p_payout_id uuid,
  p_new_status text,
  p_approved_amount numeric default null,
  p_admin_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_aff uuid;
  v_house uuid;
  v_amount numeric;
  v_appr numeric;
  v_status text;
  v_return numeric;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- requer owner
  if not public.is_owner_db(v_uid) then
    raise exception 'Not allowed';
  end if;

  perform set_config('row_security','off', true);

  select affiliate_id, house_id, amount, approved_amount, status
    into v_aff, v_house, v_amount, v_appr, v_status
  from public.payout_requests
  where id = p_payout_id
  for update;

  if not found then
    raise exception 'Payout not found';
  end if;

  if p_new_status not in ('approved','paid','refused') then
    raise exception 'Invalid status';
  end if;

  -- valor aprovado para paid
  if p_new_status = 'paid' then
    v_appr := coalesce(p_approved_amount, v_appr, v_amount);
    if v_appr < 0 then v_appr := 0; end if;
    if v_appr > v_amount then v_appr := v_amount; end if;
    v_return := greatest(0, v_amount - v_appr);

    update public.affiliate_houses
    set commission_requested = greatest(0, commission_requested - v_amount),
        commission_paid = coalesce(commission_paid,0) + v_appr,
        commission_available = coalesce(commission_available,0) + v_return
    where id = v_house;

    update public.payout_requests
    set status = 'paid',
        approved_amount = v_appr,
        admin_note = p_admin_note,
        processed_at = now()
    where id = p_payout_id;

    return true;
  end if;

  if p_new_status = 'refused' then
    -- recusado: solicitado -> disponível (volta pro afiliado sacar de novo)
    update public.affiliate_houses
    set commission_requested = greatest(0, commission_requested - v_amount),
        commission_refused = coalesce(commission_refused,0) + v_amount,
        commission_available = coalesce(commission_available,0) + v_amount
    where id = v_house;

    update public.payout_requests
    set status = 'refused',
        admin_note = p_admin_note,
        processed_at = now()
    where id = p_payout_id;

    return true;
  end if;

  -- approved (sem movimentar saldo)
  update public.payout_requests
  set status = 'approved',
      approved_amount = coalesce(p_approved_amount, approved_amount),
      admin_note = p_admin_note
  where id = p_payout_id;

  return true;
end;
$$;

grant execute on function public.finalize_payout(uuid, text, numeric, text) to authenticated;

commit;
