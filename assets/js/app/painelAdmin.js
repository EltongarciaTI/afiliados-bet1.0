/**
 * Afiliados Bet | Admin
 *
 * Este arquivo controla o painel do OWNER:
 * - Selecionar afiliado
 * - Editar configurações do afiliado (profiles)
 * - Inserir/editar métricas diárias (affiliate_stats_daily)
 *
 * Dica: procure por "// UI:" para achar rapidamente onde mexer na interface.
 */

import { requireAuth, signOut } from "./autenticacao.js";
import { supabase } from "./clienteSupabase.js";
import { formatBRL, formatInt, getMonthRanges } from "./metricas.js";
import { TELEGRAM_HELP_URL } from "./config.js";

// ---------- Helpers ----------

const $ = (id) => document.getElementById(id);

function safeDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "-";
  }
}

function num(v) {
  return Number(v || 0);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value ?? "";
}

function setVal(id, value) {
  const el = $(id);
  if (el) el.value = value ?? "";
}

function getVal(id) {
  const el = $(id);
  return el ? el.value : "";
}

function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "--";
  const parts = s.replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

let dataTableInstance = null;
let approvalSearchBound = false;

// ---------- Overview (KPIs do admin) ----------

async function loadAdminOverview() {
  // KPIs são opcionais (se o HTML tiver os IDs, mostramos)
  const kTotal = document.getElementById("kpiTotalAffiliates");
  const kPend = document.getElementById("kpiPendingApprovals");
  const kReq  = document.getElementById("kpiPendingPlatformRequests");
  const kPay  = document.getElementById("kpiPendingPayouts");
  if (!kTotal && !kPend && !kReq && !kPay) return;

  try {
    const [profilesAll, profilesPending, reqPending, payoutPending] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
      supabase.from("affiliate_house_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("payout_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    if (kTotal) kTotal.textContent = String(profilesAll.count ?? 0);
    if (kPend)  kPend.textContent  = String(profilesPending.count ?? 0);
    if (kReq)   kReq.textContent   = String(reqPending.count ?? 0);
    if (kPay)   kPay.textContent   = String(payoutPending.count ?? 0);
  } catch (err) {
    // KPI é só "nice". Não pode derrubar o admin.
    console.warn("Falha ao carregar KPIs do admin:", err);
  }
}

// ---------- Casas (múltiplas) ----------

function houseCommissionText(h) {
  const modelo = String(h.comissao_modelo || "cpa").toLowerCase();
  const baseline = Number(h.baseline || 0);
  const cpa = Number(h.cpa || 0);
  const rev = Number(h.rev || 0);
  let txt = modelo === "rev" ? `Rev ${rev}%` : (modelo === "hibrido" ? `Híbrido: CPA ${formatBRL(cpa)} + Rev ${rev}%` : `CPA ${formatBRL(cpa)}`);
  if (baseline > 0) txt += ` • Baseline ${formatBRL(baseline)}`;
  return txt;
}

async function fetchAffiliateHouses(affiliateId) {
  const { data, error } = await supabase
    .from("affiliate_houses")
    .select("id, house_name, house_link, affiliate_link, comissao_modelo, baseline, cpa, rev, commission_available, commission_requested, commission_paid, commission_refused, total_signups, total_ftds, total_deposits_amount, total_cpa_amount, total_revshare_amount, is_active, created_at")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];

}

async function fetchAffiliateHouseRequests(affiliateId) {
  const { data, error } = await supabase
    .from("affiliate_house_requests")
    .select("id, house_name, house_link, status, created_at")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

function renderHouseRequests(rows) {
  const box = document.getElementById("houseRequestsBox");
  if (!box) return;

  const pending = (rows || []).filter(r => String(r.status || "pending").toLowerCase() === "pending");
  if (!pending.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "";
  box.innerHTML = `
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div><strong>Solicitações pendentes:</strong> ${pending.length}</div>
      <div class="text-muted small">Aprove e já cria a casa no plano do afiliado.</div>
    </div>
    <div class="mt-2">
      ${pending.map(r => `
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 py-1 border-bottom" data-req="${r.id}">
          <div>
            <div><strong>${r.house_name || "-"}</strong></div>
            <div class="small text-muted">${r.house_link || ""}</div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-success btn-sm" data-act="approve" data-id="${r.id}">Aprovar</button>
            <button class="btn btn-outline-danger btn-sm" data-act="reject" data-id="${r.id}">Recusar</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  box.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      btn.disabled = true;
      try {
        if (act === "approve") await approveHouseRequest(id);
        else await rejectHouseRequest(id);
        // atualiza tela
        const sel = document.getElementById("affiliateSelect");
        const affiliateId = sel?.value;
        if (affiliateId) {
          const [reqs, houses] = await Promise.all([
            fetchAffiliateHouseRequests(affiliateId).catch(()=>[]),
            fetchAffiliateHouses(affiliateId).catch(()=>[]),
          ]);
          renderHouseRequests(reqs);
          _housesAll = houses;
          applyHousesFilter();
          renderAffiliateHousesCard(houses);
        }
      } catch (e) {
        console.error(e);
        alert("Não foi possível atualizar a solicitação.");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function approveHouseRequest(requestId){
  // Busca a solicitação
  const { data: req, error: e1 } = await supabase
    .from("affiliate_house_requests")
    .select("id, affiliate_id, house_name, house_link")
    .eq("id", requestId)
    .maybeSingle();
  if (e1) throw e1;
  if (!req) throw new Error("Solicitação não encontrada.");

  // Evita duplicar casa pelo nome
  const { data: exists, error: e2 } = await supabase
    .from("affiliate_houses")
    .select("id")
    .eq("affiliate_id", req.affiliate_id)
    .eq("house_name", req.house_name)
    .maybeSingle();
  if (e2) throw e2;

  if (!exists) {
    const { error: e3 } = await supabase
      .from("affiliate_houses")
      .insert({
        affiliate_id: req.affiliate_id,
        house_name: req.house_name,
        house_link: req.house_link,
        comissao_modelo: "cpa",
        baseline: 0,
        cpa: 0,
        rev: 0,
        commission_available: 0,
        commission_requested: 0,
        commission_paid: 0,
        commission_refused: 0,
        total_signups: 0,
        total_ftds: 0,
        total_deposits_amount: 0,
        total_cpa_amount: 0,
        total_revshare_amount: 0,
        is_active: true,
      });
    if (e3) throw e3;
  }

  const { error: e4 } = await supabase
    .from("affiliate_house_requests")
    .update({ status: "approved" })
    .eq("id", requestId);
  if (e4) throw e4;
}

async function rejectHouseRequest(requestId){
  const { error } = await supabase
    .from("affiliate_house_requests")
    .update({ status: "rejected" })
    .eq("id", requestId);
  if (error) throw error;
}




function renderAffiliateHousesCard(rows){
  const box = document.getElementById("affiliateHousesCard");
  if(!box) return;

  if(!rows || !rows.length){
    box.innerHTML = `<div class="alert alert-secondary mb-0">🏠 Nenhuma casa aprovada para este afiliado.</div>`;
    return;
  }

  const cards = rows.slice(0,6).map(h=>{
    const link = h.affiliate_link ? `<a href="${h.affiliate_link}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-light">Abrir link</a>` : "";
    const active = h.is_active ? `<span class="badge bg-success">Ativa</span>` : `<span class="badge bg-secondary">Inativa</span>`;
    const model = `<span class="badge bg-dark">${String(h.comissao_modelo||"cpa").toUpperCase()}</span>`;

    const chips = `
      <div class="d-flex gap-2 flex-wrap mt-2">
        <span class="ab-chip is-ok"><span class="dot"></span>Disp: <b>${formatBRL(h.commission_available)}</b></span>
        <span class="ab-chip is-warn"><span class="dot"></span>Sol.: <b>${formatBRL(h.commission_requested)}</b></span>
        <span class="ab-chip is-ok"><span class="dot"></span>Pago: <b>${formatBRL(h.commission_paid)}</b></span>
        <span class="ab-chip is-ok"><span class="dot"></span>Rec: <b>${formatBRL(h.commission_refused)}</b></span>
      </div>
    `;

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="card border-0" style="background:rgba(255,255,255,.06);">
          <div class="card-body py-3">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div style="font-weight:800">${h.house_name || "Casa"}</div>
                <div class="text-muted" style="font-size:.85rem">${active} ${model}</div>
                ${chips}
              </div>
              <button class="btn btn-sm btn-outline-danger js-house-del" data-id="${h.id}" title="Remover casa">🗑️</button>
            </div>

            <div class="mt-2 d-flex gap-2 flex-wrap">
              ${link}
              <button class="btn btn-sm btn-outline-info js-house-edit" data-id="${h.id}">Editar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  box.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-2">
      <div style="font-weight:800">🏠 Casas aprovadas</div>
      <small class="text-muted">${rows.length} no total</small>
    </div>
    <div class="row g-2">${cards}</div>
  `;
}



// Casas (UI state)
let _affiliatesAll = [];
let _housesAll = [];

function setHousesTotals(rows){
  const box = document.getElementById('housesTotals');
  if(!box) return;
  const sum = (k)=> (rows||[]).reduce((acc,r)=> acc + Number(r?.[k]||0), 0);
  const available = sum('commission_available');
  const requested = sum('commission_requested');
  const paid = sum('commission_paid');
  const refused = sum('commission_refused');
  box.innerHTML = `
    <span class="ab-chip is-ok" title="Saldo disponível somado"><span class="dot"></span>Disp: <b>${formatBRL(available)}</b></span>
    <span class="ab-chip is-warn" title="Solicitado (em análise)"><span class="dot"></span>Sol.: <b>${formatBRL(requested)}</b></span>
    <span class="ab-chip is-info" title="Total pago"><span class="dot"></span>Pago: <b>${formatBRL(paid)}</b></span>
    <span class="ab-chip is-bad" title="Total recusado"><span class="dot"></span>Rec.: <b>${formatBRL(refused)}</b></span>
  `;
}

function applyHousesFilter(){
  const q = String(document.getElementById('housesSearch')?.value || '').trim().toLowerCase();
  const showInactive = !!document.getElementById('housesShowInactive')?.checked;
  let rows = Array.isArray(_housesAll) ? [..._housesAll] : [];
  if(!showInactive) rows = rows.filter(r=> !!r.is_active);
  if(q){
    rows = rows.filter(r=>{
      const hay = [r.house_name,r.house_link,r.affiliate_link,r.comissao_modelo].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  renderHousesTable(rows);
  setHousesTotals(rows);
}

function renderHousesTable(rows) {
  const tbody = document.getElementById("housesTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Nenhuma casa cadastrada para este afiliado.</td></tr>`;
    return;
  }

  for (const h of rows) {
    const tr = document.createElement("tr");
    const links = `
      ${h.house_link ? `<a href="${h.house_link}" target="_blank" rel="noopener noreferrer">Casa</a>` : "-"}
      ${h.affiliate_link ? ` • <a href="${h.affiliate_link}" target="_blank" rel="noopener noreferrer">Link afiliado</a>` : ""}
    `;
    const metrics = `Cad: ${formatInt(h.total_signups)} • FTD: ${formatInt(h.total_ftds)} • Dep: ${formatBRL(h.total_deposits_amount)}`;
    tr.dataset.id = h.id;
    tr.innerHTML = `
      <td>
        <div class="fw-semibold">${h.house_name || "-"}</div>
        <div class="small text-muted">${h.is_active ? `<span class="badge bg-success">Ativa</span>` : `<span class="badge bg-secondary">Inativa</span>`}</div>
      </td>
      <td><span class="badge bg-dark">${String(h.comissao_modelo || "cpa").toUpperCase()}</span></td>
      <td>
        <div class="small">${houseCommissionText(h)}</div>
        <div class="small text-muted">Disp: ${formatBRL(h.commission_available)} • Sol.: ${formatBRL(h.commission_requested)} • Pago: ${formatBRL(h.commission_paid)}</div>
      </td>
      <td class="small">${links}</td>
      <td class="small">${metrics}</td>
      <td>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-outline-primary js-edit-house" type="button">Editar</button>
          <button class="btn btn-sm btn-outline-danger js-del-house" type="button">Remover</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function clearHouseForm() {
  setVal("house_id", "");
  setVal("house_name", "");
  setVal("house_link", "");
  setVal("affiliate_link", "");
  setVal("house_model", "cpa");
  setVal("house_baseline", 0);
  setVal("house_cpa", 0);
  setVal("house_rev", 0);
  setVal("h_commission_available", 0);
  setVal("h_commission_requested", 0);
  setVal("h_commission_paid", 0);
  setVal("h_commission_refused", 0);
  setVal("h_signups", 0);
  setVal("h_ftds", 0);
  setVal("h_deposits", 0);
  setVal("h_cpa_amount", 0);
  setVal("h_rev_amount", 0);
  const chk = document.getElementById("h_active");
  if (chk) chk.checked = true;
}

function readHouseForm() {
  const chk = document.getElementById("h_active");
  return {
    id: getVal("house_id") || null,
    house_name: String(getVal("house_name") || "").trim(),
    house_link: String(getVal("house_link") || "").trim() || null,
    affiliate_link: String(getVal("affiliate_link") || "").trim() || null,
    comissao_modelo: String(getVal("house_model") || "cpa").toLowerCase(),
    baseline: Number(getVal("house_baseline") || 0),
    cpa: Number(getVal("house_cpa") || 0),
    rev: Number(getVal("house_rev") || 0),
    commission_available: Number(getVal("h_commission_available") || 0),
    commission_requested: Number(getVal("h_commission_requested") || 0),
    commission_paid: Number(getVal("h_commission_paid") || 0),
    commission_refused: Number(getVal("h_commission_refused") || 0),
    total_signups: Number(getVal("h_signups") || 0),
    total_ftds: Number(getVal("h_ftds") || 0),
    total_deposits_amount: Number(getVal("h_deposits") || 0),
    total_cpa_amount: Number(getVal("h_cpa_amount") || 0),
    total_revshare_amount: Number(getVal("h_rev_amount") || 0),
    is_active: chk ? !!chk.checked : true,
  };
}

function fillHouseForm(h) {
  setVal("house_id", h.id);
  setVal("house_name", h.house_name || "");
  setVal("house_link", h.house_link || "");
  setVal("affiliate_link", h.affiliate_link || "");
  setVal("house_model", (h.comissao_modelo || "cpa").toLowerCase());
  setVal("house_baseline", h.baseline ?? 0);
  setVal("house_cpa", h.cpa ?? 0);
  setVal("house_rev", h.rev ?? 0);
  setVal("h_commission_available", h.commission_available ?? 0);
  setVal("h_commission_requested", h.commission_requested ?? 0);
  setVal("h_commission_paid", h.commission_paid ?? 0);
  setVal("h_commission_refused", h.commission_refused ?? 0);
  setVal("h_signups", h.total_signups ?? 0);
  setVal("h_ftds", h.total_ftds ?? 0);
  setVal("h_deposits", h.total_deposits_amount ?? 0);
  setVal("h_cpa_amount", h.total_cpa_amount ?? 0);
  setVal("h_rev_amount", h.total_revshare_amount ?? 0);
  const chk = document.getElementById("h_active");
  if (chk) chk.checked = !!h.is_active;
}

async function syncProfileCommissionsFromHouses(affiliateId) {
  // Para manter SAQUE e dashboard sempre coerentes, somamos as casas
  // e gravamos os totais no profiles.commission_*.
  const rows = await fetchAffiliateHouses(affiliateId);
  const sumField = (k) => rows.reduce((acc, r) => acc + Number(r?.[k] || 0), 0);
  const payload = {
    commission_available: sumField("commission_available"),
    commission_requested: sumField("commission_requested"),
    commission_paid: sumField("commission_paid"),
    commission_refused: sumField("commission_refused"),
  };
  const { error } = await supabase.from("profiles").update(payload).eq("id", affiliateId);
  if (error) throw error;
}

async function setApprovalStatus(profileId, status) {
  const st = String(status || "").toLowerCase();
  // IMPORTANTE:
  // Evita erro 400 quando o banco não possui colunas como approved_at/rejected_at.
  // Aqui atualizamos apenas o campo canônico approval_status.
  const patch = { approval_status: st };

  const { error } = await supabase.from("profiles").update(patch).eq("id", profileId);
  if (error) throw error;
}


async function deleteAffiliate(profileId) {
  // Remove COMPLETAMENTE o afiliado (Auth + Profile + dados relacionados via cascade)
  const { data, error } = await supabase.rpc("admin_delete_affiliate", { p_user_id: profileId });
  if (error) throw error;
  return data;
}

function applyApprovalFilter() {
  const q = String(document.getElementById("approvalSearch")?.value || "").trim().toLowerCase();
  const tbody = document.querySelector("#approvalTable tbody");
  const rows = tbody ? Array.from(tbody.querySelectorAll("tr")) : [];
  let shown = 0;

  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    // linha de placeholder (colspan)
    if (tds.length === 1) {
      tr.style.display = "";
      shown = rows.length;
      continue;
    }
    const nome = (tds[0]?.textContent || "").toLowerCase();
    const email = (tds[1]?.textContent || "").toLowerCase();
    const ok = !q || nome.includes(q) || email.includes(q);
    tr.style.display = ok ? "" : "none";
    if (ok) shown++;
  }

  const c = document.getElementById("approvalCount");
  if (c && rows.length && rows[0].querySelectorAll("td").length > 1) {
    c.textContent = `${shown} registro(s) exibido(s)`;
  } else if (c) {
    c.textContent = "";
  }
}

function bindApprovalSearchOnce() {
  if (approvalSearchBound) return;
  const input = document.getElementById("approvalSearch");
  if (!input) return;
  approvalSearchBound = true;
  input.addEventListener("input", applyApprovalFilter);
}

// Aprovações (cadastros pendentes)
async function loadPendingApprovals() {
  const tbody = document.querySelector("#approvalTable tbody");
  const hint = $("approvalHint");
  if (!tbody) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, full_name, instagram, whatsapp, email, approval_status, created_at")
    .or("role.is.null,role.neq.owner")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;

  tbody.innerHTML = "";
  const rows = data || [];

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Nenhum cadastro pendente.</td></tr>`;
    if (hint) hint.textContent = "";
    return;
  }

  if (hint) hint.textContent = "";

  for (const p of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.full_name || p.name || "-"}</td>
      <td>${p.email || "-"}</td>
      <td>${p.whatsapp || "-"}</td>
      <td>${p.instagram || "-"}</td>
      <td>${safeDate(p.created_at)}</td>
      <td>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-success action-btn" data-action="approve" data-id="${p.id}">
            Aprovar
          </button>
          <button class="btn btn-sm btn-danger action-btn" data-action="reject" data-id="${p.id}">
            Recusar
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      if (!id) return;

      if (action === "edit") {
        return; // não existe mais
      }

      const sure = action === "approve"
        ? confirm("Aprovar este afiliado?")
        : confirm("Recusar este afiliado? (ele não conseguirá acessar o painel)");
      if (!sure) return;

      try {
        btn.disabled = true;
        await setApprovalStatus(id, action === "approve" ? "approved" : "rejected");

	        await loadPendingApprovals();
	        await loadAffiliates();

      } catch (err) {
        console.error(err);
        alert("Não foi possível atualizar o status. Verifique RLS do profiles.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  bindApprovalSearchOnce();
  applyApprovalFilter();
}


// ---------- Data (Supabase) ----------

/**
 * Carrega afiliados para o select.
 * Observação: `.neq('role','owner')` NÃO pega `role = null`.
 * Por isso usamos OR para incluir null.
 */
async function loadAffiliates() {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, name, full_name, instagram, whatsapp, approval_status, email, role, affiliate_code, created_at, casa_nome, casa_link, link_marcha, comissao_modelo, baseline, cpa, rev"
    )
    .or("role.is.null,role.neq.owner")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const sel = $("affiliateSelect");
  sel.innerHTML = "";

  for (const p of data || []) {
    const opt = document.createElement("option");

    // IMPORTANTÍSSIMO: `value` precisa ser o UUID do profile.
    // A tabela affiliate_stats_daily.affiliate_id espera UUID.
    opt.value = p.id;

    // UI: no select queremos apenas o e-mail (simples e limpo).
    const st = String(p.approval_status || "pending").toLowerCase();
    const badge = st === "approved" ? "" : (st === "rejected" ? " [RECUSADO]" : " [PENDENTE]");
    opt.textContent = `${p.email || "(sem email)"}${badge}`;

    // Guardamos infos extras para exibir no painel.
    opt.dataset.email = p.email || "";
    opt.dataset.created = p.created_at || "";
    opt.dataset.status = st;

    sel.appendChild(opt);
  }

  if ((data || []).length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nenhum afiliado encontrado";
    sel.appendChild(opt);
  }
}

function renderAffiliateSelect(list){
  const sel = $("affiliateSelect");
  if(!sel) return;
  sel.innerHTML = "";

  for (const p of list || []) {
    const opt = document.createElement("option");
    opt.value = p.id;

    const st = String(p.approval_status || "pending").toLowerCase();
    const badge = st === "approved" ? "" : (st === "rejected" ? " [RECUSADO]" : " [PENDENTE]");
    opt.textContent = `${p.email || "(sem email)"}${badge}`;

    opt.dataset.email = p.email || "";
    opt.dataset.created = p.created_at || "";
    opt.dataset.status = st;

    sel.appendChild(opt);
  }

  if ((list || []).length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nenhum afiliado encontrado";
    sel.appendChild(opt);
  }
}

async function loadStats(affiliateId) {
  const ranges = getMonthRanges();

  const { data, error } = await supabase
    .from("affiliate_stats_daily")
    .select(
      "id, day, signups, ftds, ftd_amount, qftds_cpa, cpa_amount, deposits_amount, revshare_amount"
    )
    .eq("affiliate_id", affiliateId)
    .gte("day", ranges.thisMonth.from)
    .lte("day", ranges.thisMonth.to)
    .order("day", { ascending: false });

  if (error) throw error;

  const tbody = document.querySelector("#adminStatsTable tbody");
  tbody.innerHTML = "";

  for (const r of data || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${safeDate(r.day)}</td>
      <td>${formatInt(r.signups)}</td>
      <td>${formatInt(r.ftds)}</td>
      <td>${formatBRL(r.ftd_amount)}</td>
      <td>${formatInt(r.qftds_cpa)}</td>
      <td>${formatBRL(r.cpa_amount)}</td>
      <td>${formatBRL(r.deposits_amount)}</td>
      <td>${formatBRL(r.revshare_amount)}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary action-btn" data-action="edit" data-day="${
          r.day
        }">Editar</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // UI: Datatable (se existir)
  if (window.$ && $.fn && $.fn.DataTable) {
    if (dataTableInstance) dataTableInstance.destroy();
    dataTableInstance = $("#adminStatsTable").DataTable({
      pageLength: 10,
      order: [[0, "desc"]],
      language: {
        emptyTable: "Nenhum dado disponível no momento.",
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

  // UI: botões de editar
  tbody.querySelectorAll("[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.getAttribute("data-day");
      const row = (data || []).find((x) => x.day === day);
      openModalWithRow(row, "set");
    });
  });
}

async function loadAffiliateConfig(affiliateId) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "casa_nome, casa_link, link_marcha, comissao_modelo, baseline, cpa, rev, commission_available, commission_requested, commission_paid, commission_refused"
    )
    .eq("id", affiliateId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    [
      "casa_nome",
      "casa_link",
      "link_marcha",
      "comissao_modelo",
      "baseline",
      "cpa",
      "rev",
      "commission_available",
      "commission_requested",
      "commission_paid",
      "commission_refused",
    ].forEach((k) => setVal(k, ""));
    return;
  }

  setVal("casa_nome", data.casa_nome);
  setVal("casa_link", data.casa_link);
  setVal("link_marcha", data.link_marcha);
  setVal("comissao_modelo", data.comissao_modelo);
  setVal("baseline", data.baseline ?? 0);
  setVal("cpa", data.cpa ?? 0);
  setVal("rev", data.rev ?? 0);

  // Comissões (saldos)
  setVal("commission_available", data.commission_available ?? 0);
  setVal("commission_requested", data.commission_requested ?? 0);
  setVal("commission_paid", data.commission_paid ?? 0);
  setVal("commission_refused", data.commission_refused ?? 0);
}

async function saveAffiliateConfig(affiliateId) {
  const payload = {
    casa_nome: getVal("casa_nome"),
    casa_link: getVal("casa_link"),
    link_marcha: getVal("link_marcha"),
    comissao_modelo: getVal("comissao_modelo"),
    baseline: Number(getVal("baseline") || 0),
    cpa: Number(getVal("cpa") || 0),
    rev: Number(getVal("rev") || 0),
  };

  const { error } = await supabase.from("profiles").update(payload).eq("id", affiliateId);
  if (error) throw error;
}

async function saveCommissions(affiliateId) {
  const payload = {
    commission_available: Number(getVal("commission_available") || 0),
    commission_requested: Number(getVal("commission_requested") || 0),
    commission_paid: Number(getVal("commission_paid") || 0),
    commission_refused: Number(getVal("commission_refused") || 0),
  };

  const { error } = await supabase.from("profiles").update(payload).eq("id", affiliateId);
  if (error) throw error;
}

function getMetricMode() {
  const el = document.querySelector("input[name='metricMode']:checked");
  return el?.value || "add";
}

/**
 * Salva as métricas do dia.
 * - mode="add" => soma com o que já existe no dia
 * - mode="set" => substitui (define o total do dia)
 */
async function upsertDay(affiliateId, mode = "add") {
  const day = getVal("day");
  if (!day) throw new Error("Dia inválido");

  const input = {
    signups: num(getVal("signups")),
    ftds: num(getVal("ftds")),
    ftd_amount: num(getVal("ftd_amount")),
    qftds_cpa: num(getVal("qftds_cpa")),
    cpa_amount: num(getVal("cpa_amount")),
    deposits_amount: num(getVal("deposits_amount")),
    revshare_amount: num(getVal("revshare_amount")),
  };

  let finalRow = { ...input };

  if (mode === "add") {
    // Soma com o existente, se existir.
    const { data: existing, error: exErr } = await supabase
      .from("affiliate_stats_daily")
      .select("signups, ftds, ftd_amount, qftds_cpa, cpa_amount, deposits_amount, revshare_amount")
      .eq("affiliate_id", affiliateId)
      .eq("day", day)
      .maybeSingle();
    if (exErr) throw exErr;

    if (existing) {
      finalRow = {
        signups: Number(existing.signups || 0) + input.signups,
        ftds: Number(existing.ftds || 0) + input.ftds,
        ftd_amount: Number(existing.ftd_amount || 0) + input.ftd_amount,
        qftds_cpa: Number(existing.qftds_cpa || 0) + input.qftds_cpa,
        cpa_amount: Number(existing.cpa_amount || 0) + input.cpa_amount,
        deposits_amount: Number(existing.deposits_amount || 0) + input.deposits_amount,
        revshare_amount: Number(existing.revshare_amount || 0) + input.revshare_amount,
      };
    }
  }

  const payload = {
    affiliate_id: affiliateId,
    day,
    ...finalRow,
  };

  const { error } = await supabase
    .from("affiliate_stats_daily")
    .upsert(payload, { onConflict: "affiliate_id,day" });

  if (error) throw error;
}

// ---------- UI (Modal) ----------

function setMode(mode) {
  const add = document.getElementById("modeAdd");
  const set = document.getElementById("modeSet");
  if (add && set) {
    add.checked = mode === "add";
    set.checked = mode === "set";
  }
  const title = document.getElementById("editModalTitle");
  if (title) title.textContent = mode === "add" ? "Adicionar métricas (somar)" : "Editar métricas (substituir)";
}

function openModalWithRow(row, mode = "add") {
  // Corona usa Bootstrap 4 => modal via jQuery
  const hasJQ = typeof window.$ === "function";

  setMode(mode);

  if (row) {
    setVal("day", row.day);
    setVal("signups", num(row.signups));
    setVal("ftds", num(row.ftds));
    setVal("ftd_amount", num(row.ftd_amount));
    setVal("qftds_cpa", num(row.qftds_cpa));
    setVal("cpa_amount", num(row.cpa_amount));
    setVal("deposits_amount", num(row.deposits_amount));
    setVal("revshare_amount", num(row.revshare_amount));
  } else {
    // UI: default = hoje
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    setVal("day", `${yyyy}-${mm}-${dd}`);
    [
      "signups",
      "ftds",
      "ftd_amount",
      "qftds_cpa",
      "cpa_amount",
      "deposits_amount",
      "revshare_amount",
    ].forEach((k) => setVal(k, 0));
  }

  if (hasJQ) {
    window.$("#editModal").modal("show");
  } else {
    alert("Erro: jQuery/Bootstrap não carregou. Verifique assets/corona/vendors/js/vendor.bundle.base.js");
  }
}

// ---------- Bootstrap ----------

async function init() {
  // 1) Autenticação
  const auth = await requireAuth({ role: "owner" });
  if (!auth.ok) {
    window.location.href = "entrar-admin.html";
    return;
  }

  const { user, profile } = auth;
  const nome = profile?.name || (user.email ? user.email.split("@")[0] : "Admin");

  // UI: topo
  setText("topbarNome", nome);
  setText("dropNome", nome);
  setText("dropEmail", user.email || "");

  // Avatar: iniciais (ex: Elton Garcia => EG)
  const initials = getInitials(profile?.full_name || profile?.name || user.email);
  const aTop = $("avatarTop");
  const aDrop = $("avatarDrop");
  if (aTop) aTop.textContent = initials;
  if (aDrop) aDrop.textContent = initials;

  // UI: ajuda (Telegram) — configure em assets/js/app/config.js
  const helpLink = $("btnHelp");
  if (helpLink) helpLink.href = TELEGRAM_HELP_URL;

  // UI: logout (dois botões com ids diferentes)
  $("btnLogout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await signOut();
    window.location.href = "entrar-admin.html";
  });
  $("btnLogoutTop")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "entrar-admin.html";
  });

  // 2) Carregar afiliados
  await loadAffiliates();

  // Busca rápida no select de afiliados
  const search = $("affiliateSearch");
  const sel0 = $("affiliateSelect");
  const cache = [];
  for (const opt of Array.from(sel0.options || [])) {
    cache.push({ value: opt.value, text: opt.textContent });
  }
  if (search) {
    search.addEventListener("input", () => {
      const q = String(search.value || "").trim().toLowerCase();
      sel0.innerHTML = "";
      const filtered = q
        ? cache.filter(o => String(o.text).toLowerCase().includes(q))
        : cache;
      for (const o of filtered) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.text;
        sel0.appendChild(opt);
      }
      // mantém selecionado o primeiro item visível e recarrega
      if (sel0.options.length > 0) sel0.selectedIndex = 0;
      sel0.dispatchEvent(new Event("change"));
    });
  }

  // 2.1) Carregar aprovações pendentes
  await loadPendingApprovals();
  // 2.2) KPIs do admin (opcional)
  await loadAdminOverview();

  const sel = $("affiliateSelect");
  const meta = $("affiliateMeta");

  const refresh = async () => {
    const affiliateId = sel.value;

    if (!affiliateId) {
      meta.textContent = "Nenhum afiliado selecionado.";
      return;
    }

    // Perfil completo (sempre disponível, mesmo após aprovação)
    const { data: pRow, error: pErr } = await supabase
      .from("profiles")
      .select("id, email, name, full_name, whatsapp, telegram, instagram, experience, notes, approval_status, created_at")
      .eq("id", affiliateId)
      .maybeSingle();
    if (pErr) throw pErr;

    const email = pRow?.email || "(sem email)";
    const created = pRow?.created_at ? safeDate(pRow.created_at) : "-";
    const st = String(pRow?.approval_status || "pending").toLowerCase();
    const stLabel = st === "approved" ? "APROVADO" : (st === "rejected" ? "RECUSADO" : "PENDENTE");

    // UI premium do afiliado selecionado
    const info = $("affiliateInfoCard");
    const initials = String((pRow?.full_name || pRow?.name || email || "A")).trim().slice(0,1).toUpperCase();
    const ig = pRow?.instagram ? `@${String(pRow.instagram).replace(/^@/,"")}` : "-";
    const wa = pRow?.whatsapp ? String(pRow.whatsapp) : "";
    const tg = pRow?.telegram ? String(pRow.telegram) : "";
    const exp = pRow?.experience ? String(pRow.experience) : "-";

    const statusBadge = st === "approved"
      ? `<span class="badge bg-success">Aprovado</span>`
      : (st === "rejected" ? `<span class="badge bg-danger">Recusado</span>` : `<span class="badge bg-warning">Pendente</span>`);

    if(info){
      info.innerHTML = `
        <div class="ab-aff-card">
          <div class="ab-aff-top">
            <div class="ab-aff-avatar">${initials}</div>
            <div style="flex:1;">
              <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                <div class="ab-aff-name">${pRow?.full_name || pRow?.name || "-"}</div>
                <div class="ab-aff-badges">${statusBadge}</div>
              </div>
              <div class="ab-aff-meta">${email} • Desde ${created}</div>
            </div>
          </div>

          <div class="ab-aff-grid">
            <div class="ab-aff-item"><div class="k">WhatsApp</div><div class="v">${wa || "-"}</div></div>
            <div class="ab-aff-item"><div class="k">Instagram</div><div class="v">${ig}</div></div>
            <div class="ab-aff-item"><div class="k">Telegram</div><div class="v">${tg || "-"}</div></div>
            <div class="ab-aff-item"><div class="k">Experiência</div><div class="v">${exp}</div></div>
          </div>

          <div class="mt-2" style="color:#6c7293;font-size:.9rem;">
            <strong style="color:#fff;">Obs.:</strong> ${pRow?.notes ? String(pRow.notes) : "-"}
          </div>
        </div>
      `;
    }

    // fallback invisível (para debug)
    meta.innerHTML = `${pRow?.full_name || pRow?.name || "-"} • ${email} • ${stLabel} • ${created}`;

    await loadStats(affiliateId);
    await loadAffiliateConfig(affiliateId);

    // Casas do afiliado
    try {
      const [houses, reqs] = await Promise.all([
        fetchAffiliateHouses(affiliateId),
        fetchAffiliateHouseRequests(affiliateId).catch(()=>[]),
      ]);
      _housesAll = houses;
          applyHousesFilter();
          renderAffiliateHousesCard(houses);
      renderHouseRequests(reqs);
    } catch (e) {
      // Se a tabela ainda não existe, não quebra o painel.
      const tbody = document.getElementById("housesTableBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Tabela affiliate_houses ainda não criada. Rode o SQL MULTICASAS.</td></tr>`;
      try{
        const reqs = await fetchAffiliateHouseRequests(affiliateId);
        renderHouseRequests(reqs);
      }catch{}
    }
  };

  // UI: ações rápidas no afiliado selecionado
  const act = async (newStatus) => {
    const affiliateId = sel.value;
    if (!affiliateId) return alert("Selecione um afiliado primeiro.");
    const map = {
      approved: "Aprovar este afiliado?",
      rejected: "Recusar este afiliado? (ele não conseguirá acessar o painel)",
      pending: "Reabrir este cadastro (voltar para PENDENTE)?",
      removed: "Remover este afiliado? (isso APAGA o usuário do sistema. Para entrar de novo, ele terá que criar uma nova conta e aguardar aprovação.)",
    };
    const msg = map[newStatus] || "Confirmar?";
    if (!confirm(msg)) return;
    try {
      if (newStatus === "removed") {
      await deleteAffiliate(affiliateId);
    } else {
      await setApprovalStatus(affiliateId, newStatus);
    }
      await loadPendingApprovals();
      await loadAffiliates();

      // Mantém o mesmo afiliado selecionado, se ainda existir no select
      const opt = Array.from(sel.options).find((o) => o.value === affiliateId);
      if (opt) sel.value = affiliateId;
      await refresh();
    } catch (err) {
      console.error(err);
      alert("Não foi possível atualizar o status. Verifique permissões do owner no Supabase.");
    }
  };
  $("btnReopenSelected")?.addEventListener("click", () => act("pending"));
  $("btnRemoveSelected")?.addEventListener("click", () => act("removed"));

  sel.addEventListener("change", refresh);
  $("btnRefresh")?.addEventListener("click", refresh);
  $("btnOpenAdd")?.addEventListener("click", () => openModalWithRow(null, "add"));
  $("btnOpenSet")?.addEventListener("click", () => openModalWithRow(null, "set"));

  // UI: salvar configurações do afiliado
  $("affiliateConfigForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const affiliateId = sel.value;
    if (!affiliateId) {
      alert("Selecione um afiliado primeiro.");
      return;
    }

    const btn = $("btnSaveConfig");
    const status = $("configStatus");
    btn.disabled = true;
    if (status) status.textContent = "Salvando...";

    try {
      await saveAffiliateConfig(affiliateId);
      if (status) status.textContent = "Salvo ✅";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "Erro ao salvar ❌";
      alert("Erro ao salvar configurações do afiliado. Verifique RLS do profiles.");
    } finally {
      btn.disabled = false;
    }
  });

  // UI: salvar comissões (saldos)
  $("commissionForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const affiliateId = sel.value;
    if (!affiliateId) {
      alert("Selecione um afiliado primeiro.");
      return;
    }

    const btn = $("btnSaveCommissions");
    const status = $("commissionStatus");
    btn.disabled = true;
    if (status) status.textContent = "Salvando...";

    try {
      await saveCommissions(affiliateId);
      if (status) status.textContent = "Salvo ✅";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "Erro ao salvar ❌";
      alert("Erro ao salvar comissões. Verifique permissões (owner) no Supabase.");
    } finally {
      btn.disabled = false;
    }
  });

  // UI: Casas (múltiplas)
  $("btnClearHouse")?.addEventListener("click", () => clearHouseForm());
  $("btnNewHouse")?.addEventListener("click", () => {
    // Novo cadastro: limpa form, abre editor e foca no nome
    clearHouseForm();
    const coll = document.getElementById("houseEditorCollapse");
    if (coll && window.bootstrap) {
      try { new bootstrap.Collapse(coll, { toggle: true }); } catch {}
    } else if (coll) {
      coll.classList.add("show");
    }
    setTimeout(() => {
      document.getElementById("house_name")?.focus();
      document.getElementById("affiliateHousesCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  });


  $("houseForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const affiliateId = sel.value;
    if (!affiliateId) return alert("Selecione um afiliado primeiro.");

    const status = $("housesStatus");
    const btn = $("btnSaveHouse");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Salvando...";

    try {
      const h = readHouseForm();
      if (!h.house_name || h.house_name.length < 2) {
        alert("Informe o nome da casa.");
        return;
      }

      const payload = {
        affiliate_id: affiliateId,
        house_name: h.house_name,
        house_link: h.house_link,
        affiliate_link: h.affiliate_link,
        comissao_modelo: h.comissao_modelo,
        baseline: h.baseline,
        cpa: h.cpa,
        rev: h.rev,
        commission_available: h.commission_available,
        commission_requested: h.commission_requested,
        commission_paid: h.commission_paid,
        commission_refused: h.commission_refused,
        total_signups: h.total_signups,
        total_ftds: h.total_ftds,
        total_deposits_amount: h.total_deposits_amount,
        total_cpa_amount: h.total_cpa_amount,
        total_revshare_amount: h.total_revshare_amount,
        is_active: h.is_active,
      };

      if (h.id) {
        const { error } = await supabase.from("affiliate_houses").update(payload).eq("id", h.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("affiliate_houses").insert(payload);
        if (error) throw error;
      }

      await syncProfileCommissionsFromHouses(affiliateId);
      const [houses, reqs] = await Promise.all([
        fetchAffiliateHouses(affiliateId),
        fetchAffiliateHouseRequests(affiliateId).catch(()=>[]),
      ]);
      _housesAll = houses;
          applyHousesFilter();
          renderAffiliateHousesCard(houses);
      renderHouseRequests(reqs);
      clearHouseForm();
      if (status) status.textContent = "Salvo ✅";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "Erro ao salvar ❌";
      alert("Não foi possível salvar a casa. Verifique se você rodou o SQL MULTICASAS e se o owner tem permissão.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.addEventListener("click", async (ev) => {
    const tr = ev.target.closest("#housesTable tbody tr");
    if (!tr || !tr.dataset.id) return;
    const affiliateId = sel.value;
    if (!affiliateId) return;

    try {
      if (ev.target.closest(".js-edit-house")) {
        const rows = await fetchAffiliateHouses(affiliateId);
        const row = rows.find((x) => x.id === tr.dataset.id);
        if (row) fillHouseForm(row);
      }

      if (ev.target.closest(".js-del-house")) {
        if (!confirm("Remover esta casa do afiliado?")) return;
        const { error } = await supabase.from("affiliate_houses").delete().eq("id", tr.dataset.id);
        if (error) throw error;
        await syncProfileCommissionsFromHouses(affiliateId);
        const houses = await fetchAffiliateHouses(affiliateId);
        _housesAll = houses;
          applyHousesFilter();
          renderAffiliateHousesCard(houses);
        clearHouseForm();
      }
    } catch (err) {
      console.error(err);
      alert("Não foi possível atualizar/remover a casa.");
    }
  });

  // UI: salvar métricas do dia
  $("editForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const affiliateId = sel.value;
    if (!affiliateId) {
      alert("Selecione um afiliado primeiro.");
      return;
    }

    const btn = $("btnSave");
    btn.disabled = true;

    try {
      const mode = getMetricMode();
      await upsertDay(affiliateId, mode);
      if (window.$) window.$("#editModal").modal("hide");
      // Recarregar a tabela é "nice to have". Se falhar, não queremos dizer que o salvamento falhou.
      try {
        await refresh();
      } catch (reloadErr) {
        console.warn("Salvou as métricas, mas falhou ao recarregar:", reloadErr);
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar as métricas. Verifique a conexão e as permissões do admin.");
    } finally {
      btn.disabled = false;
    }
  });

  // 3) Load inicial
  if (sel.options.length > 0) sel.selectedIndex = 0;
  await refresh();
}

init().catch((err) => {
  console.error(err);
  alert("Erro ao carregar admin. Verifique se seu usuário tem role=owner no profiles.");
});