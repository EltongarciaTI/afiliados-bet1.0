/**
 * Afiliados Bet | Admin — Página de Afiliados
 * assets/js/app/adminAfiliados.js
 */

import { requireAuth, signOut } from "./autenticacao.js";
import { supabase } from "./clienteSupabase.js";
import { formatBRL, formatInt, getMonthRanges } from "./metricas.js";
import { TELEGRAM_HELP_URL } from "./config.js";

const $ = (id) => document.getElementById(id);

function safeDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return "—"; }
}

function num(v) { return Number(v || 0); }

function setText(id, val) { const el = $(id); if (el) el.textContent = val ?? ""; }
function setVal(id, val)  { const el = $(id); if (el) el.value = val ?? ""; }
function getVal(id)       { const el = $(id); return el ? el.value : ""; }

function getInitials(str) {
  const s = String(str || "").trim();
  if (!s) return "--";
  const parts = s.replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtStatus(st) {
  const s = String(st || "pending").toLowerCase();
  if (s === "approved")  return `<span class="badge-status badge-active">Ativo</span>`;
  if (s === "rejected")  return `<span class="badge-status badge-inactive">Recusado</span>`;
  return `<span class="badge-status badge-pending">Pendente</span>`;
}

function fmtModelo(m) {
  const s = String(m || "cpa").toLowerCase();
  const map = { cpa: "badge-cpa", rev: "badge-rev", hibrido: "badge-hibrido" };
  return `<span class="badge-modelo ${map[s] || "badge-cpa"}">${s.toUpperCase()}</span>`;
}

// ─────────────────────────────────────────
// Estado global
// ─────────────────────────────────────────
let _affiliates = [];
let _housesMap = {};      // affiliate_id → [house_name, ...]
let _currentAffiliateId = null;
let _currentHouses = [];

// ─────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────
function updateKPIs(rows) {
  const ativos    = rows.filter(r => r.approval_status === "approved").length;
  const pendentes = rows.filter(r => r.approval_status === "pending").length;
  const inativos  = rows.filter(r => r.approval_status === "rejected").length;
  setText("kpiAtivos",    ativos);
  setText("kpiPendentes", pendentes);
  setText("kpiTotal",     rows.length);
  setText("kpiInativos",  inativos);
}

// ─────────────────────────────────────────
// Carregar lista de afiliados
// ─────────────────────────────────────────
async function loadAffiliates() {
  const { data, error } = await supabase
    .from("profiles")
    .select(`id, name, full_name, email, whatsapp, instagram, telegram,
      approval_status, created_at, approved_at, role`)
    .or("role.is.null,role.neq.owner")
    .order("created_at", { ascending: false });

  if (error) throw error;
  _affiliates = data || [];

  const ids = _affiliates.map(a => a.id);
  _housesMap = {};
  if (ids.length > 0) {
    const { data: hData } = await supabase
      .from("affiliate_houses")
      .select("affiliate_id, house_name")
      .in("affiliate_id", ids);
    for (const h of hData || []) {
      if (!_housesMap[h.affiliate_id]) _housesMap[h.affiliate_id] = [];
      _housesMap[h.affiliate_id].push(h.house_name || "—");
    }
  }

  updateKPIs(_affiliates);
  renderTable(_affiliates, _housesMap);
}

// ─────────────────────────────────────────
// Renderizar tabela
// ─────────────────────────────────────────
function renderTable(rows, housesMap = {}) {
  const tbody = document.querySelector("#affiliatesTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted text-center py-4">Nenhum afiliado encontrado.</td></tr>`;
    return;
  }

  for (const p of rows) {
    const initials = getInitials(p.full_name || p.name || p.email);
    const nome = p.full_name || p.name || "(sem nome)";
    const names = housesMap[p.id] || [];
    const casasLabel = names.length === 0
      ? "—"
      : names.length <= 2
        ? names.join(", ")
        : names.slice(0, 2).join(", ") + ` +${names.length - 2}`;

    const tr = document.createElement("tr");
    tr.dataset.id = p.id;
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:.65rem;">
          <div class="aff-avatar">${initials}</div>
          <div>
            <div class="aff-name">${nome}</div>
            <div class="aff-email">${p.email || "—"}</div>
          </div>
        </div>
      </td>
      <td class="small">${p.whatsapp || "—"}</td>
      <td>${fmtStatus(p.approval_status)}</td>
      <td class="small" title="${names.join(', ')}" style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${casasLabel}</td>
      <td class="small">${safeDate(p.created_at)}</td>
      <td>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${p.id}" title="Editar">
            <i class="mdi mdi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger btn-remove" data-id="${p.id}" title="Remover">
            <i class="mdi mdi-trash-can-outline"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".btn-remove")) return;
      const id = tr.dataset.id;
      if (id) openPanel(id);
    });
  });

  tbody.querySelectorAll(".btn-remove").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const row = _affiliates.find(a => a.id === id);
      const nome = row?.full_name || row?.name || row?.email || id;
      if (!confirm(`Remover afiliado "${nome}"? Isso apaga o usuário do sistema.`)) return;
      btn.disabled = true;
      try {
        const { error } = await supabase.rpc("admin_delete_affiliate", { p_user_id: id });
        if (error) throw error;
        await loadAffiliates();
        if (_currentAffiliateId === id) closePanel();
      } catch (err) {
        console.error(err);
        alert("Não foi possível remover o afiliado. Verifique as permissões.");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ─────────────────────────────────────────
// Filtro local
// ─────────────────────────────────────────
function applyFilter() {
  const q  = String($("searchAff")?.value || "").trim().toLowerCase();
  const st = String($("filterStatus")?.value || "").toLowerCase();

  const filtered = _affiliates.filter(p => {
    const matchQ = !q || [p.full_name, p.name, p.email, p.whatsapp, p.instagram]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
    const matchSt = !st || String(p.approval_status || "pending").toLowerCase() === st;
    return matchQ && matchSt;
  });

  renderTable(filtered, _housesMap);
  updateKPIs(filtered);
}

// ─────────────────────────────────────────
// Painel lateral
// ─────────────────────────────────────────
function openPanel(affiliateId) {
  _currentAffiliateId = affiliateId;
  document.getElementById("editPanel")?.classList.add("open");
  document.getElementById("editOverlay")?.classList.add("open");
  loadPanelData(affiliateId);
}

// ✅ closePanel só é chamado pelo botão X explícito
function closePanel() {
  _currentAffiliateId = null;
  document.getElementById("editPanel")?.classList.remove("open");
  document.getElementById("editOverlay")?.classList.remove("open");
  hidePanelHouseEditor();
}

async function loadPanelData(affiliateId) {
  const p = _affiliates.find(a => a.id === affiliateId) || {};
  const initials = getInitials(p.full_name || p.name || p.email);
  const panelAvatar = $("panelAvatar");
  if (panelAvatar) panelAvatar.textContent = initials;
  setText("panelName",  p.full_name || p.name || "(sem nome)");
  setText("panelEmail", p.email || "—");

  const btnVerPainel = $("btnVerPainel");
  if (btnVerPainel) {
    btnVerPainel.href = `painel.html?as=affiliate&affiliate=${affiliateId}&return=admin-afiliados.html`;
  }

  const waLink = $("panelWhatsapp");
  const waNum  = $("panelWhatsappNum");
  if (waLink && waNum) {
    if (p.whatsapp) {
      const clean = String(p.whatsapp).trim().replace(/[^\d]/g, "");
      waLink.href = `https://wa.me/${clean}`;
      waNum.textContent = p.whatsapp;
      waLink.style.display = "flex";
    } else {
      waLink.style.display = "none";
    }
  }

  const igLink = $("panelInstagram");
  const igUser = $("panelInstagramUser");
  if (igLink && igUser) {
    if (p.instagram) {
      const clean = String(p.instagram).replace(/^@/, "");
      igLink.href = `https://instagram.com/${clean}`;
      igUser.textContent = "@" + clean;
      igLink.style.display = "flex";
    } else {
      igLink.style.display = "none";
    }
  }

  await loadPanelHouses(affiliateId);
  await loadPanelStats(affiliateId);

  const { data: pendingPayouts } = await supabase
    .from("payout_requests")
    .select("id")
    .eq("affiliate_id", affiliateId)
    .eq("status", "requested");
  setText("pSaquesPendentes", (pendingPayouts || []).length);
}

// ─────────────────────────────────────────
// Casas no painel
// ─────────────────────────────────────────
async function loadPanelHouses(affiliateId) {
  const { data, error } = await supabase
    .from("affiliate_houses")
    .select(`id, house_name, house_link, affiliate_link,
      comissao_modelo, baseline, cpa, rev,
      commission_available, commission_requested, commission_paid, commission_refused,
      total_signups, total_ftds, total_qftds_cpa, total_cpa_amount, total_deposits_amount, total_revshare_amount,
      is_active, created_at`)
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });

  if (error) { console.error("Erro ao carregar casas:", error); return; }

  _currentHouses = data || [];
  setText("pCasas",  _currentHouses.length);
  setText("pQFTDs",  _currentHouses.reduce((a, h) => a + num(h.total_qftds_cpa), 0));
  renderPanelHouses(_currentHouses);
}

function renderPanelHouses(houses) {
  const box = $("panelHousesList");
  if (!box) return;

  if (!houses.length) {
    box.innerHTML = `<div class="text-muted small">Nenhuma casa cadastrada.</div>`;
    return;
  }

  box.innerHTML = houses.map(h => `
    <div class="d-flex align-items-center justify-content-between py-2"
         style="border-bottom:1px solid rgba(255,255,255,.05);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${h.house_name || "—"}
          ${!h.is_active ? `<span class="badge-status badge-inactive" style="font-size:.65rem;margin-left:.35rem;">Inativa</span>` : ""}
        </div>
        <div style="font-size:.75rem;color:#6c7293;">
          ${fmtModelo(h.comissao_modelo)}
          &nbsp;•&nbsp;Disp: <b>${formatBRL(h.commission_available)}</b>
          &nbsp;•&nbsp;Pago: <b>${formatBRL(h.commission_paid)}</b>
        </div>
      </div>
      <div class="d-flex gap-1 ms-2">
        <button class="btn btn-sm btn-outline-primary" style="padding:.2rem .45rem;"
                data-house-edit="${h.id}" title="Editar casa">
          <i class="mdi mdi-pencil" style="font-size:.85rem;"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" style="padding:.2rem .45rem;"
                data-house-del="${h.id}" title="Remover casa">
          <i class="mdi mdi-trash-can-outline" style="font-size:.85rem;"></i>
        </button>
      </div>
    </div>
  `).join("");

  box.querySelectorAll("[data-house-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const h = _currentHouses.find(x => x.id === btn.dataset.houseEdit);
      if (h) fillPanelHouseForm(h);
    });
  });

  box.querySelectorAll("[data-house-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover esta casa do afiliado?")) return;
      btn.disabled = true;
      try {
        const { error } = await supabase
          .from("affiliate_houses").delete().eq("id", btn.dataset.houseDel);
        if (error) throw error;
        await syncProfileCommissions(_currentAffiliateId);
        await loadPanelHouses(_currentAffiliateId);
      } catch (err) {
        console.error(err);
        alert("Não foi possível remover a casa.");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ─────────────────────────────────────────
// Editor de casa
// ─────────────────────────────────────────
function showPanelHouseEditor(title = "Nova casa") {
  const ed = $("panelHouseEditor");
  const tl = $("panelHouseEditorTitle");
  if (ed) ed.style.display = "";
  if (tl) tl.textContent = title;
  ed?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hidePanelHouseEditor() {
  const ed = $("panelHouseEditor");
  if (ed) ed.style.display = "none";
  clearPanelHouseForm();
}

function clearPanelHouseForm() {
  ["ph_id","ph_name","ph_link","ph_affiliate_link"].forEach(id => setVal(id, ""));
  setVal("ph_model", "cpa");
  ["ph_baseline","ph_cpa","ph_rev",
   "ph_commission_available","ph_commission_requested","ph_commission_paid","ph_commission_refused",
   "ph_signups","ph_ftds","ph_qftds_cpa","ph_cpa_amount","ph_deposits_amount","ph_rev_amount"].forEach(id => setVal(id, ""));
  const chk = $("ph_active");
  if (chk) chk.checked = true;
  setText("panelHouseStatus", "");
}

function fillPanelHouseForm(h) {
  setVal("ph_id",                   h.id);
  setVal("ph_name",                 h.house_name || "");
  setVal("ph_link",                 h.house_link || "");
  setVal("ph_affiliate_link",       h.affiliate_link || "");
  setVal("ph_model",                (h.comissao_modelo || "cpa").toLowerCase());
  setVal("ph_baseline",             h.baseline ?? "");
  setVal("ph_cpa",                  h.cpa ?? "");
  setVal("ph_rev",                  h.rev ?? "");
  setVal("ph_commission_available", h.commission_available ?? "");
  setVal("ph_commission_requested", h.commission_requested ?? "");
  setVal("ph_commission_paid",      h.commission_paid ?? "");
  setVal("ph_commission_refused",   h.commission_refused ?? "");
  setVal("ph_signups",              h.total_signups ?? "");
  setVal("ph_ftds",                 h.total_ftds ?? "");
  setVal("ph_qftds_cpa",            h.total_qftds_cpa ?? "");
  setVal("ph_cpa_amount",           h.total_cpa_amount ?? "");
  setVal("ph_deposits_amount",      h.total_deposits_amount ?? "");
  setVal("ph_rev_amount",           h.total_revshare_amount ?? "");
  const chk = $("ph_active");
  if (chk) chk.checked = !!h.is_active;
  showPanelHouseEditor("Editar casa");
}

function readPanelHouseForm() {
  const chk = $("ph_active");
  return {
    id:                    getVal("ph_id") || null,
    house_name:            String(getVal("ph_name") || "").trim(),
    house_link:            String(getVal("ph_link") || "").trim() || null,
    affiliate_link:        String(getVal("ph_affiliate_link") || "").trim() || null,
    comissao_modelo:       String(getVal("ph_model") || "cpa").toLowerCase(),
    baseline:              num(getVal("ph_baseline")),
    cpa:                   num(getVal("ph_cpa")),
    rev:                   num(getVal("ph_rev")),
    commission_available:  num(getVal("ph_commission_available")),
    commission_requested:  num(getVal("ph_commission_requested")),
    commission_paid:       num(getVal("ph_commission_paid")),
    commission_refused:    num(getVal("ph_commission_refused")),
    total_signups:         num(getVal("ph_signups")),
    total_ftds:            num(getVal("ph_ftds")),
    total_qftds_cpa:       num(getVal("ph_qftds_cpa")),
    total_cpa_amount:      num(getVal("ph_cpa_amount")),
    total_deposits_amount: num(getVal("ph_deposits_amount")),
    total_revshare_amount: num(getVal("ph_rev_amount")),
    is_active:             chk ? !!chk.checked : true,
  };
}

// ─────────────────────────────────────────
// Sincroniza comissões
// ─────────────────────────────────────────
async function syncProfileCommissions(affiliateId) {
  const { data, error } = await supabase
    .from("affiliate_houses")
    .select("commission_available, commission_requested, commission_paid, commission_refused")
    .eq("affiliate_id", affiliateId);
  if (error) throw error;

  const sum = (k) => (data || []).reduce((a, r) => a + num(r[k]), 0);
  const { error: e2 } = await supabase.from("profiles").update({
    commission_available: sum("commission_available"),
    commission_requested: sum("commission_requested"),
    commission_paid:      sum("commission_paid"),
    commission_refused:   sum("commission_refused"),
  }).eq("id", affiliateId);
  if (e2) throw e2;
}

// ─────────────────────────────────────────
// Stats diárias
// ─────────────────────────────────────────
async function loadPanelStats(affiliateId) {
  const tbody = document.querySelector("#panelStatsTable tbody");
  if (!tbody) return;

  const ranges = getMonthRanges();
  const { data, error } = await supabase
    .from("affiliate_stats_daily")
    .select("id, day, signups, ftds, qftds_cpa, deposits_amount, revshare_amount")
    .eq("affiliate_id", affiliateId)
    .gte("day", ranges.thisMonth.from)
    .lte("day", ranges.thisMonth.to)
    .order("day", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted small">Erro ao carregar métricas.</td></tr>`;
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted small text-center py-2">Sem métricas este mês.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="small">${safeDate(r.day)}</td>
      <td class="small">${formatInt(r.signups)}</td>
      <td class="small">${formatInt(r.ftds)}</td>
      <td class="small">${formatInt(r.qftds_cpa)}</td>
      <td class="small">${formatBRL(r.deposits_amount)}</td>
      <td>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-primary" style="padding:.15rem .4rem;"
                  data-stat-edit="${r.day}" title="Editar dia">
            <i class="mdi mdi-pencil" style="font-size:.8rem;"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" style="padding:.15rem .4rem;"
                  data-stat-del="${r.id}" title="Apagar dia">
            <i class="mdi mdi-trash-can-outline" style="font-size:.8rem;"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-stat-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.statEdit;
      const row = rows.find(r => r.day === day);
      openMetricModal(row, "set");
    });
  });

  tbody.querySelectorAll("[data-stat-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.statDel;
      const cell = btn.closest("td");
      // Troca o botão por confirmação inline (sem confirm() bloqueante)
      cell.innerHTML = `
        <div class="d-flex gap-1 align-items-center">
          <span class="small text-muted" style="font-size:.72rem;">Apagar?</span>
          <button class="btn btn-sm btn-danger js-del-confirm" style="padding:.15rem .45rem;font-size:.75rem;">Sim</button>
          <button class="btn btn-sm btn-outline-secondary js-del-cancel" style="padding:.15rem .45rem;font-size:.75rem;">Não</button>
        </div>`;
      cell.querySelector(".js-del-cancel").addEventListener("click", () => {
        loadPanelStats(_currentAffiliateId);
      });
      cell.querySelector(".js-del-confirm").addEventListener("click", async () => {
        cell.innerHTML = `<span class="small text-muted">Apagando…</span>`;
        const { error } = await supabase
          .from("affiliate_stats_daily")
          .delete()
          .eq("id", id);
        if (error) {
          alert("Erro ao apagar: " + error.message);
        }
        await loadPanelStats(_currentAffiliateId);
      });
    });
  });
}

// ─────────────────────────────────────────
// Modal de métricas
// ─────────────────────────────────────────
function openMetricModal(row, mode = "add") {
  if (!_currentAffiliateId) {
    alert("Selecione um afiliado primeiro.");
    return;
  }

  const setMode = (m) => {
    const add = $("modeAdd"), set = $("modeSet");
    if (add) add.checked = m === "add";
    if (set) set.checked = m === "set";
    const title = $("editModalTitle");
    if (title) title.textContent = m === "add" ? "Adicionar métricas (somar)" : "Editar métricas (substituir)";
  };

  setMode(mode);

  if (row) {
    setVal("day",             row.day);
    setVal("signups",         num(row.signups));
    setVal("ftds",            num(row.ftds));
    setVal("qftds_cpa",       num(row.qftds_cpa));
    setVal("deposits_amount", num(row.deposits_amount));
    setVal("revshare_amount", num(row.revshare_amount));
  } else {
    const d = new Date();
    setVal("day", `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
    // ✅ Limpa os campos para permitir digitação livre
    ["signups","ftds","qftds_cpa","deposits_amount","revshare_amount"].forEach(k => setVal(k, ""));
  }

  if (window.$) window.$("#editModal").modal("show");
}

async function upsertDay(affiliateId, mode = "add") {
  const day = getVal("day");
  if (!day) throw new Error("Dia inválido");

  const input = {
    signups:         num(getVal("signups")),
    ftds:            num(getVal("ftds")),
    ftd_amount:      0,
    qftds_cpa:       num(getVal("qftds_cpa")),
    cpa_amount:      0,
    deposits_amount: num(getVal("deposits_amount")),
    revshare_amount: num(getVal("revshare_amount")),
  };

  let finalRow = { ...input };

  if (mode === "add") {
    const { data: existing } = await supabase
      .from("affiliate_stats_daily")
      .select("signups, ftds, ftd_amount, qftds_cpa, cpa_amount, deposits_amount, revshare_amount")
      .eq("affiliate_id", affiliateId)
      .eq("day", day)
      .maybeSingle();

    if (existing) {
      finalRow = {
        signups:         num(existing.signups)         + input.signups,
        ftds:            num(existing.ftds)            + input.ftds,
        ftd_amount:      num(existing.ftd_amount),
        qftds_cpa:       num(existing.qftds_cpa)       + input.qftds_cpa,
        cpa_amount:      num(existing.cpa_amount),
        deposits_amount: num(existing.deposits_amount) + input.deposits_amount,
        revshare_amount: num(existing.revshare_amount) + input.revshare_amount,
      };
    }
  }

  const { error } = await supabase
    .from("affiliate_stats_daily")
    .upsert({ affiliate_id: affiliateId, day, ...finalRow }, { onConflict: "affiliate_id,day" });

  if (error) throw error;
}

// ─────────────────────────────────────────
// Ações de status
// ─────────────────────────────────────────
async function setApprovalStatus(affiliateId, status) {
  const { error } = await supabase.from("profiles")
    .update({ approval_status: status }).eq("id", affiliateId);
  if (error) throw error;
}

async function deleteAffiliate(affiliateId) {
  const { error } = await supabase.rpc("admin_delete_affiliate", { p_user_id: affiliateId });
  if (error) throw error;
}

// ─────────────────────────────────────────
// Init
// ─────────────────────────────────────────
async function init() {
  const auth = await requireAuth({ role: "owner" });
  if (!auth.ok) {
    window.location.href = "entrar-admin.html";
    return;
  }

  const { user, profile } = auth;
  const nome = profile?.name || (user.email ? user.email.split("@")[0] : "Admin");
  setText("topbarNome", nome);
  setText("dropNome",   nome);
  setText("dropEmail",  user.email || "");

  const helpLink = $("btnHelp");
  if (helpLink) helpLink.href = TELEGRAM_HELP_URL;

  $("btnLogoutTop")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "entrar-admin.html";
  });

  try {
    await loadAffiliates();
  } catch (err) {
    console.error(err);
    const msg = $("affMsg");
    if (msg) msg.innerHTML = `<div class="alert alert-danger">Erro ao carregar afiliados: ${err.message}</div>`;
  }

  $("searchAff")?.addEventListener("input", applyFilter);
  $("filterStatus")?.addEventListener("change", applyFilter);
  $("btnReloadAff")?.addEventListener("click", async () => {
    $("searchAff").value = "";
    $("filterStatus").value = "";
    await loadAffiliates();
  });

  // ✅ Somente o botão X fecha o painel — overlay não tem listener de clique
  $("btnClosePanel")?.addEventListener("click", closePanel);

  $("btnActivate")?.addEventListener("click", async () => {
    if (!_currentAffiliateId) return;
    if (!confirm("Ativar este afiliado?")) return;
    try {
      await setApprovalStatus(_currentAffiliateId, "approved");
      const p = _affiliates.find(a => a.id === _currentAffiliateId);
      if (p) p.approval_status = "approved";
      applyFilter(); updateKPIs(_affiliates);
      alert("Afiliado ativado ✅");
    } catch (err) { console.error(err); alert("Erro ao ativar afiliado."); }
  });

  $("btnReopen")?.addEventListener("click", async () => {
    if (!_currentAffiliateId) return;
    if (!confirm("Reabrir cadastro (voltar para pendente)?")) return;
    try {
      await setApprovalStatus(_currentAffiliateId, "pending");
      const p = _affiliates.find(a => a.id === _currentAffiliateId);
      if (p) p.approval_status = "pending";
      applyFilter(); updateKPIs(_affiliates);
      alert("Cadastro reaberto ✅");
    } catch (err) { console.error(err); alert("Erro ao reabrir cadastro."); }
  });

  $("btnRemove")?.addEventListener("click", async () => {
    if (!_currentAffiliateId) return;
    const p = _affiliates.find(a => a.id === _currentAffiliateId);
    const nome = p?.full_name || p?.name || p?.email || "este afiliado";
    if (!confirm(`Remover "${nome}"? Isso apaga o usuário permanentemente.`)) return;
    try {
      await deleteAffiliate(_currentAffiliateId);
      closePanel();
      await loadAffiliates();
    } catch (err) { console.error(err); alert("Não foi possível remover. Verifique as permissões."); }
  });

  $("btnNewHousePanel")?.addEventListener("click", () => {
    clearPanelHouseForm();
    showPanelHouseEditor("Nova casa");
  });

  $("btnCancelHousePanel")?.addEventListener("click", hidePanelHouseEditor);

  $("panelHouseForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!_currentAffiliateId) { alert("Nenhum afiliado selecionado."); return; }

    const h = readPanelHouseForm();
    if (!h.house_name || h.house_name.length < 2) { alert("Informe o nome da casa."); return; }

    const btn = $("btnSaveHousePanel");
    const status = $("panelHouseStatus");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Salvando…";

    try {
      const payload = {
        affiliate_id:          _currentAffiliateId,
        house_name:            h.house_name,
        house_link:            h.house_link,
        affiliate_link:        h.affiliate_link,
        comissao_modelo:       h.comissao_modelo,
        baseline:              h.baseline,
        cpa:                   h.cpa,
        rev:                   h.rev,
        commission_available:  h.commission_available,
        commission_requested:  h.commission_requested,
        commission_paid:       h.commission_paid,
        commission_refused:    h.commission_refused,
        total_signups:         h.total_signups,
        total_ftds:            h.total_ftds,
        total_qftds_cpa:       h.total_qftds_cpa,
        total_cpa_amount:      h.total_cpa_amount,
        total_deposits_amount: h.total_deposits_amount,
        total_revshare_amount: h.total_revshare_amount,
        is_active:             h.is_active,
      };

      if (h.id) {
        const { error } = await supabase.from("affiliate_houses").update(payload).eq("id", h.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("affiliate_houses").insert(payload);
        if (error) throw error;
      }

      await syncProfileCommissions(_currentAffiliateId);
      await loadPanelHouses(_currentAffiliateId);
      hidePanelHouseEditor();
      if (status) status.textContent = "Salvo ✅";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "Erro ❌";
      alert("Não foi possível salvar a casa.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("btnPanelAddDay")?.addEventListener("click", () => {
    if (!_currentAffiliateId) { alert("Selecione um afiliado primeiro."); return; }
    openMetricModal(null, "add");
  });

  $("btnPanelEditDay")?.addEventListener("click", () => {
    if (!_currentAffiliateId) { alert("Selecione um afiliado primeiro."); return; }
    openMetricModal(null, "set");
  });

  // ✅ Fechar modal NÃO zera _currentAffiliateId — apenas recarrega stats
  if (window.$) {
    window.$("#editModal").on("hidden.bs.modal", () => {
      if (_currentAffiliateId) loadPanelStats(_currentAffiliateId);
    });
  }

  $("editForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!_currentAffiliateId) { alert("Nenhum afiliado selecionado."); return; }

    const btn = $("btnSave");
    if (btn) btn.disabled = true;

    try {
      const mode = document.querySelector("input[name='metricMode']:checked")?.value || "add";
      await upsertDay(_currentAffiliateId, mode);
      if (window.$) window.$("#editModal").modal("hide");
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar as métricas.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

init().catch(err => {
  console.error(err);
  alert("Erro ao carregar a página de afiliados. Verifique se seu usuário tem role=owner.");
});