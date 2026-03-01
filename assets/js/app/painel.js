import { requireAuth, signOut } from "./autenticacao.js";
import { fetchDashboardData, formatBRL, formatInt, getMonthRanges } from "./metricas.js";
import { supabase } from "./clienteSupabase.js";
import { TELEGRAM_HELP_URL } from "./config.js";

function getHouseParam(){
  const url = new URL(window.location.href);
  return url.searchParams.get("house");
}

async function fetchHouseById(affiliateId, houseId){
  const { data, error } = await supabase
    .from("affiliate_houses")
    .select("id, house_name, commission_available, commission_requested, commission_paid, commission_refused, total_signups, total_ftds, total_deposits_amount, total_cpa_amount, total_revshare_amount")
    .eq("affiliate_id", affiliateId)
    .eq("id", houseId)
    .maybeSingle();
  if(error) throw error;
  return data || null;
}

function qs(id) { return document.getElementById(id); }

function setText(id, text) {
  const el = qs(id);
  if (el) el.textContent = text;
}

function badgeForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return `<span class="badge bg-success badge-status">Pago</span>`;
  if (s === "requested") return `<span class="badge bg-info badge-status">Solicitado</span>`;
  if (s === "refused") return `<span class="badge bg-danger badge-status">Recusado</span>`;
  return `<span class="badge bg-secondary badge-status">Pendente</span>`;
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

function commissionText(modelo, baseline, cpa, rev) {
  const m = String(modelo || "cpa").toLowerCase();
  let txt = m === "rev" ? `Rev ${Number(rev || 0)}%` : (m === "hibrido" ? `Híbrido: CPA ${formatBRL(cpa)} + Rev ${Number(rev || 0)}%` : `CPA ${formatBRL(cpa)}`);
  if (Number(baseline || 0) > 0) txt += ` • Baseline ${formatBRL(baseline)}`;
  return txt;
}

async function fetchHouses(affiliateId) {
  const { data, error } = await supabase
    .from("affiliate_houses")
    .select("id, house_name, house_link, affiliate_link, comissao_modelo, baseline, cpa, rev, total_signups, total_ftds, total_deposits_amount, total_cpa_amount, total_revshare_amount, is_active")
    .eq("affiliate_id", affiliateId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
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
  const status = (profile?.approval_status || "pending").toLowerCase();
  if (role !== "owner" && status !== "approved") {
    window.location.href = "aguarde.html";
    return;
  }

  // Topbar: nome + email + logout
  const nome = profile?.name || (user.email ? user.email.split("@")[0] : "Afiliado");
  setText("topbarNome", nome);
  setText("dropNome", nome);
  setText("dropEmail", user.email || "");

  // Avatar: iniciais
  const initials = getInitials(profile?.full_name || profile?.name || user.email);
  const aTop = qs("avatarTop");
  const aDrop = qs("avatarDrop");
  if (aTop) aTop.textContent = initials;
  if (aDrop) aDrop.textContent = initials;

  setText("roleBadge", role === "owner" ? "OWNER" : "AFILIADO");

  // Owner: se veio do admin em modo afiliado, mostramos um atalho para voltar.
  const url = new URL(window.location.href);
  const asAffiliate = url.searchParams.get("as") === "affiliate";
  const returnUrl = url.searchParams.get("return") || "";
  const backItem = document.getElementById("navBackToAdmin");
  if (backItem) backItem.style.display = (role === "owner" && asAffiliate) ? "" : "none";

  // Barra fixa "Voltar para Admin" (aparece em TODAS as telas no modo visualização)
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

  // Link do afiliado
  // ✅ Mostramos EXATAMENTE o link configurado no painel do admin (profiles.link_marcha).
  // Se não estiver configurado, exibimos vazio (sem fallback com localhost).
  const link = (profile?.link_marcha && String(profile.link_marcha).trim())
    ? String(profile.link_marcha).trim()
    : "";
  const linkInput = qs("affiliateLink");
  if (linkInput) linkInput.value = link;
  const hint = qs("affiliateLinkHint");
  if (hint) hint.textContent = link ? "" : "Seu link ainda não foi configurado. Fale com o suporte.";

  // Casas + Comissão
  // ✅ Preferência: múltiplas casas (affiliate_houses)
  // Fallback: configuração única antiga (profiles)
  const selHouse = qs("dashHouseSelect");
  const bCPA = qs("badgeCPA");
  const bBaseline = qs("badgeBaseline");
  const housesBox = qs("housesList");

  let houses = [];
  try {
    houses = await fetchHouses(user.id);
  } catch {
    houses = [];
  }

  // Esta seção de cards detalhados ficou redundante (já existe a tela de Plataformas),
  // então mantemos o container oculto para deixar o Dashboard mais limpo.
  if (housesBox) { housesBox.style.display = "none"; housesBox.innerHTML = ""; }

  function applyHouse(h){
    const cpaVal = Number(h?.cpa ?? 0);
    const baseVal = Number(h?.baseline ?? 0);
    if (bCPA) bCPA.textContent = `CPA: ${formatBRL(cpaVal)}`;
    if (bBaseline) bBaseline.textContent = `Baseline: ${formatBRL(baseVal)}`;
  }

  // Popula seletor de casas + aplica primeira
  if (selHouse) {
    if (!houses.length) {
      selHouse.innerHTML = `<option value="">Nenhuma casa</option>`;
    } else {
      selHouse.innerHTML = houses.map((h) => {
        const label = (h.house_name || h.house_link || "Casa").trim();
        return `<option value="${h.id}">${label}</option>`;
      }).join("");
      applyHouse(houses[0]);

      selHouse.addEventListener("change", () => {
        const h = houses.find(x => String(x.id) === String(selHouse.value)) || houses[0];
        applyHouse(h);
      });
    }
  } else {
    // fallback: aplica a primeira casa mesmo sem seletor
    if (houses.length) applyHouse(houses[0]);
  }

  // Link do afiliado (input do topo) = primeira casa (para facilitar copiar rápido)
  const firstLink = String(houses?.[0]?.affiliate_link || "").trim();
  if (linkInput) linkInput.value = firstLink || link;
  if (hint) hint.textContent = firstLink || link ? "" : "Seu link ainda não foi configurado. Fale com o suporte.";

  // (Removido) Cards de métricas por casa aqui no Dashboard — essas métricas ficam apenas na tela de Plataformas.
  // Mantemos o Dashboard mais limpo.


  const btnCopy = qs("btnCopyLink");
  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      try {
        if (!link) {
          alert("Seu link ainda não foi configurado. Fale com o suporte.");
          return;
        }
        await navigator.clipboard.writeText(link);
        btnCopy.innerHTML = '<i class="mdi mdi-check"></i> Copiado';
        setTimeout(() => (btnCopy.innerHTML = '<i class="mdi mdi-content-copy"></i> Copiar'), 1200);
      } catch {
        alert("Não foi possível copiar automaticamente. Selecione o link e copie.");
      }
    });
  }

  // (Sem botões flutuando no topo) — o acesso ao admin fica no menu lateral quando aplicável.

  qs("btnLogout")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "entrar.html";
  });

  // Botão Suporte — configure em assets/js/app/config.js
  const helpLink = qs("btnHelp");
  if (helpLink) helpLink.href = TELEGRAM_HELP_URL;

  // Botão sair do topo (id diferente do dropdown)
  qs("btnLogoutTop")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "entrar.html";
  });

  // Load data for current user (affiliate view)
  const affiliateId = user.id;
  const data = await fetchDashboardData(affiliateId);

  // Filtro por casa (opcional): ?house=<affiliate_houses.id>
  const houseId = getHouseParam();
  let house = null;
  if(houseId){
    try{ house = await fetchHouseById(affiliateId, houseId); }catch(e){ console.warn(e); }
  }

  setText("cAvailable", formatBRL(data.commissions.available));
  setText("cRequested", formatBRL(data.commissions.requested));
  setText("cPaid", formatBRL(data.commissions.paid));
  setText("cRefused", formatBRL(data.commissions.refused));

  setText("mSignups", formatInt(data.thisMonth.signups));
  setText("mFTDs", formatInt(data.thisMonth.ftds));
  setText("mFTDAmount", formatBRL(data.thisMonth.ftd_amount));
  setText("mQFTDs", formatInt(data.thisMonth.qftds_cpa));
  setText("mCPA", formatBRL(data.thisMonth.cpa_amount));
  setText("mDeposits", formatBRL(data.thisMonth.deposits_amount));
  setText("mRevShare", formatBRL(data.thisMonth.revshare_amount));


  // Se estiver filtrando por casa, substitui os números por métricas/valores dessa casa.
  if(house){
    // troca comissões
    setText("cAvailable", formatBRL(house.commission_available));
    setText("cRequested", formatBRL(house.commission_requested));
    setText("cPaid", formatBRL(house.commission_paid));
    setText("cRefused", formatBRL(house.commission_refused));

    // troca métricas (totais da casa)
    setText("mSignups", formatInt(house.total_signups));
    setText("mFTDs", formatInt(house.total_ftds));
    setText("mDeposits", formatBRL(house.total_deposits_amount));
    setText("mCPA", formatBRL(house.total_cpa_amount));
    setText("mRevShare", formatBRL(house.total_revshare_amount));

    // título
    const hTitle = document.getElementById("dashboardHouseTitle");
    if(hTitle) hTitle.textContent = `Filtrando por: ${house.house_name}`;
  }else{
    const hTitle = document.getElementById("dashboardHouseTitle");
    if(hTitle) hTitle.textContent = "";
  }


  // Details table (month current)
  const tbody = document.querySelector("#detailsTable tbody");
  if (tbody) {
    tbody.innerHTML = "";
    for (const r of data.thisRows) {
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
      `;
      tbody.appendChild(tr);
    }
    if (window.$ && $.fn.DataTable) {
      $("#detailsTable").DataTable({
        destroy: true,
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
  }

  // Payout table
  const pbody = document.querySelector("#payoutTable tbody");
  if (pbody) {
    pbody.innerHTML = "";
    for (const p of data.payouts) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${safeDate(p.created_at)}</td>
        <td>${formatBRL(p.amount)}</td>
        <td>${(p.method || "-")}</td>
        <td>${badgeForStatus(p.status)}</td>
        <td>${p.processed_at ? safeDate(p.processed_at) : "-"}</td>
      `;
      pbody.appendChild(tr);
    }
    if (window.$ && $.fn.DataTable) {
      $("#payoutTable").DataTable({
        destroy: true,
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
  }

  // Monthly chart (Area Chart - estilo Corona)
  const ranges = getMonthRanges();
  const labels = ["Cadastros", "FTDs", "Depósitos", "CPA", "RevShare"];
  const lastData = [
    data.lastMonth.signups,
    data.lastMonth.ftds,
    data.lastMonth.deposits_amount,
    data.lastMonth.cpa_amount,
    data.lastMonth.revshare_amount,
  ];
  const thisData = [
    data.thisMonth.signups,
    data.thisMonth.ftds,
    data.thisMonth.deposits_amount,
    data.thisMonth.cpa_amount,
    data.thisMonth.revshare_amount,
  ];

  const ctx = document.getElementById("monthlyChart");
  if (ctx && window.Chart) {
    // Chart.js 2.x (igual ao Corona)
    const chartCtx = ctx.getContext("2d");
    new Chart(chartCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `Mês passado ( → )`,
            data: lastData,
            borderColor: "#ffab00",
            backgroundColor: "rgba(255, 171, 0, 0.15)",
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 4,
            fill: true,
          },
          {
            label: `Mês atual ( → )`,
            data: thisData,
            borderColor: "#00d25b",
            backgroundColor: "rgba(0, 210, 91, 0.15)",
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 4,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        legend: { position: "bottom", labels: { fontColor: "#6c7293" } },
        tooltips: { enabled: true },
        scales: {
          yAxes: [{
            ticks: { beginAtZero: true, fontColor: "#6c7293" },
            gridLines: { color: "rgba(204, 204, 204, 0.1)" },
          }],
          xAxes: [{
            ticks: { fontColor: "#6c7293" },
            gridLines: { color: "rgba(204, 204, 204, 0.1)" },
          }],
        },
      },
    });
  }

} // end init

init().catch((err) => {
  console.error(err);
  alert("Não foi possível carregar seus dados agora. Tente novamente em alguns instantes.");
});