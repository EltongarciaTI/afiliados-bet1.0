import { supabase } from "./clienteSupabase.js";

export function formatBRL(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function formatInt(value) {
  return (Number(value || 0)).toLocaleString("pt-BR");
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getMonthRanges() {
  const now = new Date();
  const thisStart = startOfMonth(now);
  const thisEnd = endOfMonth(now);
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastStart = startOfMonth(last);
  const lastEnd = endOfMonth(last);
  return {
    thisMonth: { from: toISODate(thisStart), to: toISODate(thisEnd) },
    lastMonth: { from: toISODate(lastStart), to: toISODate(lastEnd) },
  };
}

export async function fetchDashboardData(affiliateId) {
  /**
   * COMISSÕES (fonte principal = profiles)
   * -------------------------------------
   * O painel do OWNER define os saldos diretamente no perfil do afiliado:
   * - commission_available
   * - commission_requested
   * - commission_paid
   * - commission_refused
   *
   * Motivo: é o fluxo mais simples e “à prova de erro” para operação diária.
   *
   * Obs.: A tabela `commissions_ledger` pode existir para histórico no futuro,
   * mas o dashboard NÃO depende dela.
   */

  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("commission_available, commission_requested, commission_paid, commission_refused")
    .eq("id", affiliateId)
    .maybeSingle();
  if (pErr) throw pErr;

  const commissions = {
    available: Number(prof?.commission_available || 0),
    requested: Number(prof?.commission_requested || 0),
    paid: Number(prof?.commission_paid || 0),
    refused: Number(prof?.commission_refused || 0),
  };

  // Month comparison (stats aggregated daily)
  const ranges = getMonthRanges();
  const { data: thisRows, error: e1 } = await supabase
    .from("affiliate_stats_daily")
    .select("day, signups, ftds, ftd_amount, qftds_cpa, cpa_amount, deposits_amount, revshare_amount")
    .eq("affiliate_id", affiliateId)
    .gte("day", ranges.thisMonth.from)
    .lte("day", ranges.thisMonth.to)
    .order("day", { ascending: true });
  if (e1) throw e1;

  const { data: lastRows, error: e2 } = await supabase
    .from("affiliate_stats_daily")
    .select("day, signups, ftds, ftd_amount, qftds_cpa, cpa_amount, deposits_amount, revshare_amount")
    .eq("affiliate_id", affiliateId)
    .gte("day", ranges.lastMonth.from)
    .lte("day", ranges.lastMonth.to)
    .order("day", { ascending: true });
  if (e2) throw e2;

  const sum = (rows) => {
    const acc = {
      signups: 0,
      ftds: 0,
      ftd_amount: 0,
      qftds_cpa: 0,
      cpa_amount: 0,
      deposits_amount: 0,
      revshare_amount: 0,
    };
    for (const r of rows || []) {
      acc.signups += Number(r.signups || 0);
      acc.ftds += Number(r.ftds || 0);
      acc.ftd_amount += Number(r.ftd_amount || 0);
      acc.qftds_cpa += Number(r.qftds_cpa || 0);
      acc.cpa_amount += Number(r.cpa_amount || 0);
      acc.deposits_amount += Number(r.deposits_amount || 0);
      acc.revshare_amount += Number(r.revshare_amount || 0);
    }
    return acc;
  };

  const thisMonth = sum(thisRows);
  const lastMonth = sum(lastRows);

  // Payout history
  const { data: payouts, error: payErr } = await supabase
    .from("payout_requests")
    .select("id, amount, method, status, created_at, processed_at, admin_note")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (payErr) throw payErr;

  return { commissions, thisRows: thisRows || [], lastRows: lastRows || [], thisMonth, lastMonth, payouts: payouts || [] };
}
