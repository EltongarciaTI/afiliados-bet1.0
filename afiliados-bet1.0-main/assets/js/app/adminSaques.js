import { requireAuth, signOut } from "./autenticacao.js";
import { supabase } from "./clienteSupabase.js";
import { formatBRL } from "./metricas.js";
import { TELEGRAM_HELP_URL } from "./config.js";

function qs(id) { return document.getElementById(id); }

let _rowsCache = [];

function isUuid(v){
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function showMsg(type, text) {
  const box = qs("adminMsg");
  if (!box) return;
  const cls = type === "ok" ? "alert-success" : (type === "warn" ? "alert-warning" : "alert-danger");
  box.innerHTML = `<div class="alert ${cls}">${text}</div>`;
}

function badge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return `<span class="badge bg-success">Pago</span>`;
  if (s === "approved") return `<span class="badge bg-info">Aprovado</span>`;
  if (s === "requested") return `<span class="badge bg-warning">Em análise</span>`;
  if (s === "refused") return `<span class="badge bg-danger">Recusado</span>`;
  return `<span class="badge bg-secondary">-</span>`;
}

function safeDate(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return "-"; }
}

function pixText(p) {
  const name = p.full_name ? String(p.full_name) : "-";
  const cpf = p.cpf ? String(p.cpf) : "-";
  const pix = p.pix_key ? String(p.pix_key) : "-";
  const bank = p.bank_name ? String(p.bank_name) : "-";
  return `
    <div style="line-height:1.25">
      <div><b>${name}</b></div>
      <div class="text-muted" style="font-size:.85rem">CPF: ${cpf}</div>
      <div class="text-muted" style="font-size:.85rem">Pix: ${pix}</div>
      <div class="text-muted" style="font-size:.85rem">Banco: ${bank}</div>
    </div>
  `;
}


async function fetchPayouts() {
  const status = String(qs("filterStatus")?.value || "").trim();

  // Busca enxuta (mais rápida). Depois buscamos profiles em lote.
  let q = supabase
    .from("payout_requests")
    .select("id, affiliate_id, amount, approved_amount, status, admin_note, created_at, processed_at, full_name, cpf, pix_key, bank_name, house_id, house_name, deleted_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (status) q = q.eq("status", status);

  const { data: rows, error } = await q;
  if (error) throw error;

  const ids = Array.from(new Set((rows || []).map(r => r.affiliate_id).filter(Boolean)));
  let profMap = {};
  if (ids.length) {
    const { data: profs, error: pe } = await supabase
      .from("profiles")
      .select("id, email, name, full_name")
      .in("id", ids);
    if (!pe && profs) {
      profMap = Object.fromEntries(profs.map(p => [p.id, p]));
    }
  }

  return (rows || []).map(r => ({ ...r, profiles: profMap[r.affiliate_id] || null }));
}

function render(rows) {
  const tbody = document.querySelector("#adminPayoutTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const r of rows) {
    const prof = r.profiles;
    const who = prof?.full_name || prof?.name || prof?.email || r.affiliate_id;

    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    tr.innerHTML = `
      <td>${safeDate(r.created_at)}</td>
      <td>${who}</td>
      <td>${r.house_name || "-"}</td>
      <td>${formatBRL(r.amount)}</td>
      <td>
        <input class="form-control form-control-sm js-approved" type="number" step="0.01" min="0" value="${r.approved_amount ?? ""}" placeholder="0,00" style="max-width:140px;" />
      </td>
      <td>${badge(r.status)}</td>
      <td>${pixText(r)}</td>
      <td>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap;min-width:210px;">
          <button class="btn btn-sm btn-outline-info js-approve" type="button"><i class="mdi mdi-check"></i> Aprovar</button>
          <button class="btn btn-sm btn-outline-success js-paid" type="button"><i class="mdi mdi-cash-check"></i> Pago</button>
          <button class="btn btn-sm btn-outline-danger js-refuse" type="button"><i class="mdi mdi-close"></i> Recusar</button>
          <button class="btn btn-sm btn-outline-secondary js-del" type="button" title="Remover do histórico"><i class="mdi mdi-trash-can-outline"></i> Excluir</button>
        </div>
        <div class="mt-2">
          <input class="form-control form-control-sm js-note" type="text" value="${r.admin_note ?? ""}" placeholder="Obs. do admin" />
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  if (window.$ && $.fn.DataTable) {
    $("#adminPayoutTable").DataTable({
      destroy: true,
      pageLength: 10,
      order: [[0, "desc"]],
      language: {
        emptyTable: "Nenhuma solicitação.",
        info: "Mostrando _START_ a _END_ de _TOTAL_ registros",
        infoEmpty: "Mostrando 0 a 0 de 0 registros",
        infoFiltered: "(filtrado de _MAX_ registros)",
        lengthMenu: "Mostrar _MENU_",
        loadingRecords: "Carregando...",
        processing: "Processando...",
        search: "Buscar:",
        zeroRecords: "Nenhum registro encontrado.",
        paginate: { next: "Próximo", previous: "Anterior" },
      },
    });
  }
}


function num(v){ const n = Number(v||0); return Number.isFinite(n) ? n : 0; }

async function getPayoutById(id){
  const { data, error } = await supabase
    .from("payout_requests")
    .select("id, affiliate_id, house_id, house_name, amount, approved_amount, status")
    .eq("id", /^\d+$/.test(String(id)) ? Number(id) : id)
    .maybeSingle();
  if(error) throw error;
  return data;
}

async function updatePayout(id, patch){
  const processed = (patch.status === "paid" || patch.status === "refused") ? new Date().toISOString() : undefined;
  const { error } = await supabase
    .from("payout_requests")
    .update({ ...patch, processed_at: processed })
    .eq("id", id);
  if (error) throw error;
}

async function hardDeletePayout(id){
  const rawId = String(id || "").trim();

  // Se o ID do payout for numérico (tabela antiga), mantém seu comportamento antigo
  if (/^\d+$/.test(rawId)) {
    const payout = await getPayoutById(rawId);

    const { error: ue } = await supabase
      .from("payout_requests")
      .delete()
      .eq("id", rawId);
    if (ue) throw ue;

    // antigo: devolve por casa (se existir)
    const st = String(payout?.status || "").toLowerCase();
    if (payout?.house_id && (st === "requested" || st === "approved")) {
      const { data: house, error: he } = await supabase
        .from("affiliate_houses")
        .select("id, commission_available, commission_requested")
        .eq("id", payout.house_id)
        .eq("affiliate_id", payout.affiliate_id)
        .maybeSingle();
      if (he) throw he;
      if (house) {
        const amt = Math.max(0, num(payout.amount));
        const available = num(house.commission_available) + amt;
        const requested = Math.max(0, num(house.commission_requested) - amt);

        const { error: be } = await supabase
          .from("affiliate_houses")
          .update({ commission_available: available, commission_requested: requested })
          .eq("id", house.id);
        if (be) throw be;
      }
    }
    return;
  }

  // UUID (novo): devolve saldo no PROFILES antes de apagar (se estiver em análise/aprovado)
  const payout = await getPayoutById(rawId);
  const st = String(payout?.status || "").toLowerCase();
  const amt = Math.max(0, num(payout?.amount));

  if (amt > 0 && (st === "requested" || st === "approved" || st === "pending")) {
    // devolve solicitado -> disponível
    const { data: prof, error: pe } = await supabase
      .from("profiles")
      .select("id, commission_available, commission_requested")
      .eq("id", payout.affiliate_id)
      .maybeSingle();
    if (pe) throw pe;

    if (prof) {
      const available = num(prof.commission_available) + amt;
      const requested = Math.max(0, num(prof.commission_requested) - amt);

      const { error: ue2 } = await supabase
        .from("profiles")
        .update({ commission_available: available, commission_requested: requested })
        .eq("id", prof.id);
      if (ue2) throw ue2;
    }
  }

  // agora apaga o payout
  const { error: de } = await supabase
    .from("payout_requests")
    .delete()
    .eq("id", rawId);

  if (de) throw de;
}

async function moveHouseBalances({ affiliate_id, house_id, amount, approved_amount }, toStatus){
  // house_id é obrigatório para manter saldo por casa
  if(!house_id) return;

  // Pega saldos atuais
  const { data: house, error: he } = await supabase
    .from("affiliate_houses")
    .select("id, commission_available, commission_requested, commission_paid, commission_refused")
    .eq("id", house_id)
    .eq("affiliate_id", affiliate_id)
    .maybeSingle();
  if(he) throw he;
  if(!house) return;

  const reqAmt = Math.max(0, num(amount));
  const payAmt = Math.max(0, num(approved_amount || amount));

  let available = num(house.commission_available);
  let requested = num(house.commission_requested);
  let paid = num(house.commission_paid);
  let refused = num(house.commission_refused);

  // regra:
  // - ao solicitar, o afiliado já moveu available -> requested
  // - ao marcar PAGO: requested diminui, paid aumenta; se aprovado < solicitado, devolve diferença para available
  // - ao RECUSAR: requested diminui, devolve para available e acumula refused (histórico)
  if(toStatus === "paid"){
    requested = Math.max(0, requested - reqAmt);
    paid = Math.max(0, paid + payAmt);
    const diff = Math.max(0, reqAmt - payAmt);
    if(diff > 0) available = Math.max(0, available + diff);
  }

  if(toStatus === "refused"){
    requested = Math.max(0, requested - reqAmt);
    available = Math.max(0, available + reqAmt);
    refused = Math.max(0, refused + reqAmt);
  }

  const { error: ue } = await supabase
    .from("affiliate_houses")
    .update({
      commission_available: available,
      commission_requested: requested,
      commission_paid: paid,
      commission_refused: refused
    })
    .eq("id", house.id);
  if(ue) throw ue;
}

// Fallback para IDs numéricos (estrutura antiga): não existe RPC atômico, então finaliza manualmente.
// IMPORTANTE: precisa ficar no escopo global para o processStatusChange conseguir chamar.
async function finalizePayoutManual(id, patch){
  const payout = await getPayoutById(id);
  if (!payout) throw new Error("Saque não encontrado.");

  const newStatus = String(patch.status || "").toLowerCase();
  const approvedAmount = (patch.approved_amount ?? payout.approved_amount ?? null);

  // Atualiza payout
  await updatePayout(id, {
    status: newStatus,
    approved_amount: approvedAmount,
    admin_note: patch.admin_note ?? null,
  });

  // Ajusta saldos por casa quando for paid/refused (se existir house_id)
  if (newStatus === "paid" || newStatus === "refused") {
    await moveHouseBalances(
      {
        affiliate_id: payout.affiliate_id,
        house_id: payout.house_id,
        amount: payout.amount,
        approved_amount: approvedAmount,
      },
      newStatus
    );
  }
}

async function processStatusChange(id, patch){
  const st = String(patch.status || "").toLowerCase();
  const rawId = String(id || "").trim();

  // Sempre pega o payout atual para ter o amount correto
  const payout = await getPayoutById(rawId);
  if (!payout) throw new Error("Saque não encontrado.");

  // Mantém approved_amount salvo no registro (opcional)
  const approvedAmount = (patch.approved_amount ?? payout.approved_amount ?? null);

  // ✅ Para operações que mexem em saldos (approved/paid/refused), usa a RPC (payout_id numérico)
  if (st === "approved" || st === "paid" || st === "refused") {
    // Seu banco está usando id numérico (bigint). Garante Number aqui.
    const payoutIdNum = /^\d+$/.test(String(payout.id)) ? Number(payout.id) : Number(rawId);

    const { error } = await supabase.rpc("finalize_payout_profile", {
      p_payout_id: payoutIdNum,
      p_new_status: st,
      // 🔥 Importante: para bater saldos, sempre use o valor SOLICITADO (amount)
      p_amount: num(payout.amount),
      p_admin_note: patch.admin_note ?? null,
    });
    if (error) throw error;

    // Após finalizar, se o admin informou approved_amount, salva no payout_requests
    if (approvedAmount !== null && approvedAmount !== undefined) {
      await updatePayout(rawId, { approved_amount: approvedAmount });
    }
    return;
  }

  // fallback: atualização simples (não mexe em saldo)
  await updatePayout(rawId, {
    ...patch,
    approved_amount: approvedAmount
  });
}

async function init() {
  const auth = await requireAuth({ role: "owner" });
  if (!auth.ok) {
    window.location.href = "entrar-admin.html";
    return;
  }

  // Help
  const helpLink = qs("btnHelp");
  if (helpLink) helpLink.href = TELEGRAM_HELP_URL;

  // Logout
  qs("btnLogoutTop")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "entrar-admin.html";
  });

  async function load() {
    showMsg("ok", "Carregando...");
    let rows = await fetchPayouts();
     _rowsCache = rows;

    // Busca rápida (client-side) para ficar leve
    const term = String(qs("filterSearch")?.value || "").trim().toLowerCase();
    if(term){
      rows = rows.filter(r=>{
        const who = (r.profiles?.full_name || r.profiles?.name || r.profiles?.email || r.affiliate_id || "");
        const hay = [
          who,
          r.house_name || "",
          r.full_name || "",
          r.cpf || "",
          r.pix_key || "",
          r.bank_name || "",
          String(r.amount||"")
        ].join(" ").toLowerCase();
        return hay.includes(term);
      });
    }

    // Summary
    const sum = { requested:0, approved:0, paid:0, refused:0 };
    for(const r of rows){
      const s = String(r.status||"").toLowerCase();
      if(sum[s] != null) sum[s] += 1;
    }
    qs("sumRequested") && (qs("sumRequested").textContent = sum.requested);
    qs("sumApproved") && (qs("sumApproved").textContent = sum.approved);
    qs("sumPaid") && (qs("sumPaid").textContent = sum.paid);
    qs("sumRefused") && (qs("sumRefused").textContent = sum.refused);

    render(rows);
    if (!rows.length) {
      showMsg("ok", "Nenhum saque solicitado no momento.");
    } else {
      showMsg("ok", `Carregado: ${rows.length} registro(s).`);
    }
  }

  qs("btnReload")?.addEventListener("click", load);
  qs("filterStatus")?.addEventListener("change", load);

  let _t;
  qs("filterSearch")?.addEventListener("input", ()=>{
    clearTimeout(_t);
    _t = setTimeout(load, 180);
  });

  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const tr = btn.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;
    if (!id) return;

    const approvedVal = Number(tr.querySelector(".js-approved")?.value || 0);
    const note = String(tr.querySelector(".js-note")?.value || "").trim();

    try {
      if (btn.classList.contains("js-approve")) {
        if (!approvedVal || approvedVal <= 0) {
          showMsg("warn", "Informe o valor aprovado antes de aprovar.");
          return;
        }
        await processStatusChange(id, { approved_amount: approvedVal, status: "approved", admin_note: note || null });
        showMsg("ok", "Saque aprovado.");
        await load();
      }

     if (btn.classList.contains("js-paid")) {
  // se o admin preencheu valor aprovado, manda junto
  const approved = approvedVal && approvedVal > 0 ? approvedVal : null;
  await processStatusChange(id, { status: "paid", approved_amount: approved, admin_note: note || null });
  showMsg("ok", "Marcado como pago.");
  await load();
}

      if (btn.classList.contains("js-refuse")) {
        await processStatusChange(id, { status: "refused", admin_note: note || null });
        showMsg("ok", "Solicitação recusada.");
        await load();
      }

      if (btn.classList.contains("js-del")) {
  const sure = confirm("Apagar este saque do banco?\n\nSe estiver em análise/aprovado, o valor volta para Disponível.");
  if (!sure) return;
  await hardDeletePayout(id);
  tr?.remove();        // some da tela na hora
  showMsg("ok", "Saque apagado.");
  return;
}

    } catch (e) {
      console.error(e);
      showMsg("err", e?.message || "Não foi possível atualizar.");
    }
  });

  await load();
}

init();