import { requireAuth, signOut } from "./autenticacao.js";
import { supabase } from "./clienteSupabase.js";
import { formatBRL } from "./metricas.js";
import { TELEGRAM_HELP_URL } from "./config.js";

function qs(id) { return document.getElementById(id); }

function showMsg(type, text) {
  const box = qs("wMsg");
  if (!box) return;
  if (!text) { box.innerHTML = ""; return; }
  const cls = type === "ok" ? "alert-success" : (type === "warn" ? "alert-warning" : "alert-danger");
  box.innerHTML = `<div class="alert ${cls}">${text}</div>`;
}

function badgeForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return `<span class="badge bg-success">Pago</span>`;
  if (s === "approved") return `<span class="badge bg-info">Aprovado</span>`;
  if (s === "requested" || s === "pending") return `<span class="badge bg-warning">Em análise</span>`;
  if (s === "refused" || s === "rejected") return `<span class="badge bg-danger">Recusado</span>`;
  return `<span class="badge bg-secondary">-</span>`;
}

function safeDate(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return "-"; }
}

function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "--";
  const parts = s.replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function fetchProfileCommissions(affiliateId) {
  // ⚠️ IMPORTANTE: A Dashboard usa PROFILES como fonte principal para comissões.
  const { data, error } = await supabase
    .from("profiles")
    .select("commission_available, commission_requested, commission_paid, commission_refused")
    .eq("id", affiliateId)
    .maybeSingle();
  if (error) throw error;

  return {
    available: Number(data?.commission_available || 0),
    requested: Number(data?.commission_requested || 0),
    paid: Number(data?.commission_paid || 0),
    refused: Number(data?.commission_refused || 0),
  };
}

async function fetchPayouts(affiliateId) {
  const { data, error } = await supabase
    .from("payout_requests")
    .select("id, amount, approved_amount, status, admin_note, created_at")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

function renderTable(pays) {
  const tbody = document.querySelector("#wTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const p of pays || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${safeDate(p.created_at)}</td>
      <td>${formatBRL(p.amount)}</td>
      <td>${badgeForStatus(p.status)}</td>
      <td>${p.approved_amount == null ? "-" : formatBRL(p.approved_amount)}</td>
      <td>${p.admin_note ? String(p.admin_note) : "-"}</td>
    `;
    tbody.appendChild(tr);
  }

  if (window.$ && window.$.fn && window.$.fn.DataTable) {
    window.$("#wTable").DataTable({
      destroy: true,
      pageLength: 10,
      order: [[0, "desc"]],
      language: {
        emptyTable: "Nenhum saque ainda.",
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

async function init() {
  const auth = await requireAuth();
  if (!auth.ok) {
    window.location.href = "entrar.html";
    return;
  }

  const { user, profile } = auth;

  // Bloqueia afiliado não aprovado
  const role = profile?.role || "affiliate";
  const approval = (profile?.approval_status || "pending").toLowerCase();
  if (role !== "owner" && approval !== "approved") {
    window.location.href = "aguarde.html";
    return;
  }

  // Topbar
  const nome = profile?.name || (user.email ? user.email.split("@")[0] : "Afiliado");
  qs("topbarNome") && (qs("topbarNome").textContent = nome);
  qs("dropNome") && (qs("dropNome").textContent = nome);
  qs("dropEmail") && (qs("dropEmail").textContent = user.email || "");
  qs("roleBadge") && (qs("roleBadge").textContent = role === "owner" ? "OWNER" : "AFILIADO");

  const initials = getInitials(profile?.full_name || profile?.name || user.email);
  const aTop = qs("avatarTop");
  const aDrop = qs("avatarDrop");
  if (aTop) aTop.textContent = initials;
  if (aDrop) aDrop.textContent = initials;

  // Owner: modo afiliado
  const url = new URL(window.location.href);
  const asAffiliate = url.searchParams.get("as") === "affiliate";
  const returnUrl = url.searchParams.get("return") || "";
  const backItem = document.getElementById("navBackToAdmin");
  if (backItem) backItem.style.display = (role === "owner" && asAffiliate) ? "" : "none";

  if (role === "owner" && asAffiliate && returnUrl) {
    const bar = document.createElement("div");
    bar.style.cssText = "position:sticky;top:0;z-index:9999;background:#111827;color:#fff;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px";
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;opacity:.95">
        <span style="font-size:14px">🔎 Modo Admin (ver como afiliado)</span>
      </div>
      <a href="${returnUrl}" style="color:#fff;text-decoration:underline;font-weight:600">⬅ Voltar para Admin</a>
    `;
    document.body.prepend(bar);
  }

  // Help
  const helpLink = qs("btnHelp");
  if (helpLink) helpLink.href = TELEGRAM_HELP_URL;

  // Logout
  qs("btnLogoutTop")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "entrar.html";
  });

  // ✅ Fonte do saldo = PROFILES (igual ao Dashboard)
  let comm = await fetchProfileCommissions(user.id);
  qs("wPaid") && (qs("wPaid").textContent = formatBRL(comm.paid));
  qs("wPending") && (qs("wPending").textContent = formatBRL(comm.requested));
  qs("wAvailable") && (qs("wAvailable").textContent = formatBRL(comm.available));
  qs("wAvailableSmall") && (qs("wAvailableSmall").textContent = formatBRL(comm.available));
  qs("wAvailableSmallDup") && (qs("wAvailableSmallDup").textContent = formatBRL(comm.available));

  // Botão: desativa automaticamente se não houver saldo
  const btnReq = qs("btnRequest");
  if (btnReq) {
    btnReq.disabled = !(comm.available > 0);
    btnReq.title = comm.available > 0 ? "" : "Saldo indisponível para saque";
  }

  // Histórico
  const pays = await fetchPayouts(user.id);
  renderTable(pays);

  // Solicitar (sem casa)
  qs("btnRequest")?.addEventListener("click", async () => {
    try {
      showMsg("", "");

      const amount = Number(qs("wAmount")?.value || 0);
      const full_name = String(qs("wFullName")?.value || "").trim();
      const cpf = String(qs("wCPF")?.value || "").replace(/\D/g, "");
      const pix_key = String(qs("wPix")?.value || "").trim();
      const bank_name = String(qs("wBank")?.value || "").trim();

      if (!amount || amount <= 0) return showMsg("warn", "Informe um valor válido.");
      if (amount > Number(comm.available || 0)) return showMsg("warn", "Valor maior que o saldo disponível.");

      if (!full_name || full_name.length < 3) return showMsg("warn", "Informe seu nome completo.");
      if (cpf.length < 11) return showMsg("warn", "Informe um CPF válido.");
      if (!pix_key) return showMsg("warn", "Informe sua chave Pix.");
      if (!bank_name) return showMsg("warn", "Informe o banco.");

      // Insere solicitação
      // IMPORTANTE: usamos o sufixo _v2 para evitar conflito com funções antigas (overload)
      // que podem existir no banco e causar erro de UUID (22P02).
      const { data: payoutId, error } = await supabase.rpc("request_payout_profile_v2", {
  p_amount: amount,
  p_full_name: full_name,
  p_cpf: cpf,
  p_pix_key: pix_key,
  p_bank_name: bank_name
});

if (error) {
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("saldo")) return showMsg("warn", "Saldo indisponível para saque.");
  throw error;
}

      // Recarrega comissões (pra refletir exatamente o que o owner setou)
      comm = await fetchProfileCommissions(user.id);
      qs("wPaid") && (qs("wPaid").textContent = formatBRL(comm.paid));
      qs("wPending") && (qs("wPending").textContent = formatBRL(comm.requested));
      qs("wAvailable") && (qs("wAvailable").textContent = formatBRL(comm.available));
      qs("wAvailableSmall") && (qs("wAvailableSmall").textContent = formatBRL(comm.available));
      qs("wAvailableSmallDup") && (qs("wAvailableSmallDup").textContent = formatBRL(comm.available));

      const btn = qs("btnRequest");
      if (btn) {
        btn.disabled = !(comm.available > 0);
        btn.title = comm.available > 0 ? "" : "Saldo indisponível para saque";
      }

      const pays2 = await fetchPayouts(user.id);
      renderTable(pays2);

    } catch (e) {
      console.error(e);
      const msg = (e && (e.message || e.error_description)) ? String(e.message || e.error_description) : "";
      const code = e && e.code ? ` (${e.code})` : "";
      showMsg("danger", msg ? (msg + code) : "Não foi possível solicitar o saque. Verifique seus dados.");
    }
  });
}

init().catch((e) => {
  console.error(e);
  const msg = e && e.message ? String(e.message) : "";
  const code = e && e.code ? ` (${e.code})` : "";
  showMsg("danger", msg ? (msg + code) : "Erro ao carregar a tela de saque.");
});
