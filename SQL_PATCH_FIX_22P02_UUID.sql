-- =========================================================
-- PATCH 22P02: invalid input syntax for type uuid: "36"
-- Causa comum: payout_requests.id é BIGINT (bigserial),
-- mas as RPCs estavam definidas como UUID.
--
-- Rode este patch ANTES (ou junto) do SQL_SAQUES_PROFILES_V2.sql
-- =========================================================

-- 1) Remover overload antigo (UUID) se existir
drop function if exists public.finalize_payout_profile(uuid, text, numeric, text);

-- 2) Confirmar tipo do id (opcional)
-- select pg_typeof(id) as id_type from public.payout_requests limit 1;

-- 3) Se você já tinha uma request_payout_profile_v2 retornando UUID, ela será substituída
-- pelo arquivo SQL_SAQUES_PROFILES_V2.sql atualizado (agora retorna BIGINT).

