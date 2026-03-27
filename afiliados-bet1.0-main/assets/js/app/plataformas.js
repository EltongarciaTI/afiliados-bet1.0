import { supabase } from "./clienteSupabase.js";
import { requireAuth, signOut } from "./autenticacao.js";
import { formatBRL, formatInt } from "./metricas.js";

/**
 * Plataformas (Casas) - Afiliado
 * -----------------------------
 * - Mostra casas ativas já liberadas pelo admin (tabela affiliate_houses)
 * - Mostra casas disponíveis cadastradas pelo admin (tabela houses) para solicitar afiliação
 * - Solicitação cria registro em affiliate_house_requests (pending)
 *
 * Obs.: Tudo é controlado pelo admin. O afiliado só solicita e visualiza.
 */

function setHtml(id, html){ const el = document.getElementById(id); if(el) el.innerHTML = html; }
function setText(id, txt){ const el = document.getElementById(id); if(el) el.textContent = txt; }

function getQueryParam(name){
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function casaBadge(status){
  const s = String(status || "").toLowerCase();
  if(s === "active") return `<span class="ab-platform-badge ab-platform-badge--ok">Aprovada</span>`;
  if(s === "pending") return `<span class="ab-platform-badge ab-platform-badge--pend">Pendente</span>`;
  if(s === "rejected") return `<span class="ab-platform-badge ab-platform-badge--off">Recusada</span>`;
  if(s === "inactive") return `<span class="ab-platform-badge ab-platform-badge--off">Inativa</span>`;
  return `<span class="ab-platform-badge ab-platform-badge--off">${status || "Disponível"}</span>`;
}

async function fetchAffiliateHouses(affiliateId){
  const { data, error } = await supabase
    .from("affiliate_houses")
    .select("id, house_name, house_link, affiliate_link, comissao_modelo, baseline, cpa, rev, commission_available, commission_requested, commission_paid, commission_refused, total_signups, total_ftds, total_deposits_amount, total_cpa_amount, total_revshare_amount, is_active, created_at")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  if(error) throw error;
  return data || [];
}

async function fetchRequests(affiliateId){
  const { data, error } = await supabase
    .from("affiliate_house_requests")
    .select("id, house_name, house_link, status, created_at")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  if(error) throw error;
  return data || [];
}

async function fetchHousesCatalog(){
  // catálogo de casas cadastradas pelo admin (pode não existir ainda)
  const { data, error } = await supabase
    .from("houses")
    .select("id, nome, link, comissao_modelo, baseline, cpa, rev, ativo, created_at")
    .eq("ativo", true)
    .order("created_at", { ascending: false });
  if(error) {
    // se a tabela não existir/coluna, retorna vazio
    console.warn("houses catalog error:", error);
    return [];
  }
  return data || [];
}

function buildCommissionText(row){
  const modelo = (row.comissao_modelo || "").toLowerCase();
  const baseline = Number(row.baseline || 0);
  const cpa = Number(row.cpa || 0);
  const rev = Number(row.rev || 0);

  if(modelo === "cpa") return `CPA ${formatBRL(cpa)}${baseline>0 ? ` • Baseline ${formatBRL(baseline)}` : ""}`;
  if(modelo === "revshare" || modelo === "rev") return `RevShare ${rev}%`;
  return `Híbrido: CPA ${formatBRL(cpa)} • RevShare ${rev}%${baseline>0 ? ` • Baseline ${formatBRL(baseline)}` : ""}`;
}

function renderCards({ assigned, requests, catalog }){
  const wrap = document.getElementById("platformCards");
  if(!wrap) return;
  wrap.classList.add("ab-platform-grid");
  wrap.innerHTML = "";

  // map requests by house_name to status
  const reqByName = new Map();
  for(const r of requests){
    reqByName.set((r.house_name||"").toLowerCase(), r);
  }

  // assigned cards first
  for(const h of assigned){
    const card = document.createElement("div");
    const status = h.is_active ? "active" : "inactive";
    const affiliateLink = h.affiliate_link
      ? `<a href="${h.affiliate_link}" target="_blank" rel="noopener" class="btn btn-outline-info btn-sm"><i class="mdi mdi-open-in-new"></i> Abrir link</a>`
      : `<span class="text-muted">Link ainda não liberado</span>`;

    card.innerHTML = `
      <div class="ab-platform-card">
        <div class="ab-platform-top">
          <div class="ab-chip"><i class="mdi mdi-cash"></i> ${formatBRL(h.commission_available)}</div>
          ${casaBadge(status)}
        </div>
        <div class="ab-platform-body">
          <p class="ab-platform-title">${h.house_name || "Casa"}</p>
          <div class="ab-platform-sub">${buildCommissionText(h)}</div>

          <div class="ab-platform-actions">
            ${affiliateLink}
            ${h.affiliate_link ? `<button class="btn btn-outline-success btn-sm btnCopyLink" data-link="${h.affiliate_link}"><i class="mdi mdi-content-copy"></i> Copiar</button>` : ``}
            ${h.house_link ? `<a href="${h.house_link}" target="_blank" rel="noopener" class="btn btn-outline-light btn-sm"><i class="mdi mdi-web"></i> Site</a>` : ``}
            <button class="btn btn-primary btn-sm btnFilter" data-house="${h.id}"><i class="mdi mdi-filter"></i> Ver métricas</button>
          </div>

          <div class="mt-3" style="font-size:13px">
            <div class="d-flex justify-content-between"><span class="text-muted">Cadastros</span><strong>${formatInt(h.total_signups)}</strong></div>
            <div class="d-flex justify-content-between"><span class="text-muted">FTDs</span><strong>${formatInt(h.total_ftds)}</strong></div>
            <div class="d-flex justify-content-between"><span class="text-muted">Depósitos</span><strong>${formatBRL(h.total_deposits_amount)}</strong></div>
          </div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  }

  // catalog cards (available to request)
  for(const c of catalog){
    // skip if already assigned by same name (rough)
    const already = assigned.some(a => (a.house_name||"").toLowerCase() === (c.nome||"").toLowerCase());
    if(already) continue;

    const r = reqByName.get((c.nome||"").toLowerCase());
    const status = r?.status || null;

    const card = document.createElement("div");
    const btnHtml = status === "pending"
      ? `<button class="btn btn-warning btn-sm" disabled>Solicitação enviada</button>`
      : status === "rejected"
        ? `<button class="btn btn-outline-danger btn-sm btnRequest" data-id="${c.id}" data-house="${c.nome}" data-link="${c.link||""}">Solicitar novamente</button>`
        : `<button class="btn btn-outline-success btn-sm btnRequest" data-id="${c.id}" data-house="${c.nome}" data-link="${c.link||""}">Solicitar afiliação</button>`;

    card.innerHTML = `
      <div class="ab-platform-card">
        <div class="ab-platform-top">
          <div class="ab-chip"><i class="mdi mdi-tag-multiple"></i> ${buildCommissionText({
            comissao_modelo: c.comissao_modelo,
            baseline: c.baseline,
            cpa: c.cpa,
            rev: c.rev
          })}</div>
          <div>${casaBadge(status || "Disponível")}</div>
        </div>
        <div class="ab-platform-body">
          <p class="ab-platform-title">${c.nome}</p>
          <div class="ab-platform-sub">Solicite e aguarde aprovação do gerente.</div>

          <div class="ab-platform-actions">
            ${c.link ? `<a href="${c.link}" target="_blank" rel="noopener" class="btn btn-outline-light btn-sm"><i class="mdi mdi-web"></i> Site</a>` : ``}
            ${btnHtml}
          </div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  }

  // bind actions
  wrap.querySelectorAll(".btnRequest").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const house_id = btn.getAttribute("data-id");
      const house_name = btn.getAttribute("data-house");
      const house_link = btn.getAttribute("data-link");
      btn.disabled = true;
      try{
        await requestAffiliation(window.__affiliateId, { house_id, house_name, house_link });
        await loadAndRender(window.__affiliateId);
      }catch(e){
        console.error(e);
        alert("Não foi possível solicitar agora. Tente novamente.");
      }finally{
        btn.disabled = false;
      }
    });
  });

  wrap.querySelectorAll(".btnFilter").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const houseId = btn.getAttribute("data-house");
      const sel = document.getElementById("houseFilter");
      if(sel){
        sel.value = houseId;
        sel.dispatchEvent(new Event("change"));
      }
      window.location.href = `painel.html?house=${encodeURIComponent(houseId)}`;
    });
  });
}

async function requestAffiliation(affiliateId, payload){
  const { error } = await supabase
    .from("affiliate_house_requests")
    .insert({
      affiliate_id: affiliateId,
      house_id: payload.house_id || null,
      house_name: payload.house_name,
      house_link: payload.house_link,
      status: "pending",
    });
  if(error) throw error;
}

function renderRequests(requests){
  const box = document.getElementById("requestsBox");
  if(!box) return;

  if(!requests.length){
    box.innerHTML = `<div class="text-muted">Nenhuma solicitação ainda.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>Casa</th><th>Status</th><th>Data</th></tr></thead>
        <tbody>
          ${requests.map(r=>`
            <tr>
              <td>${r.house_name || "-"}</td>
              <td>${casaBadge(r.status)}</td>
              <td>${new Date(r.created_at).toLocaleString("pt-BR")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function loadAndRender(affiliateId){
  setText("platformMsg", "Carregando...");
  const [assigned, requests, catalog] = await Promise.all([
    fetchAffiliateHouses(affiliateId).catch(()=>[]),
    fetchRequests(affiliateId).catch(()=>[]),
    fetchHousesCatalog().catch(()=>[]),
  ]);

  const sel = document.getElementById("houseFilter");
  if(sel){
    // populate
    const current = sel.value || "all";
    sel.innerHTML = `<option value="all">Todas as casas</option>` + assigned.map(h=>`<option value="${h.id}">${h.house_name}</option>`).join("");
    sel.value = current;
    sel.onchange = ()=>{
      const v = sel.value;
      if(v === "all"){
        setText("platformMsg", `${assigned.length} casa(s) liberada(s).`);
      }else{
        const hh = assigned.find(x=>x.id===v);
        setText("platformMsg", hh ? `Filtrando por: ${hh.house_name}` : "");
      }
    };
    sel.dispatchEvent(new Event("change"));
  }

  renderCards({ assigned, requests, catalog });
  renderRequests(requests);

  if(!assigned.length && !catalog.length){
    setText("platformMsg", "Nenhuma plataforma cadastrada pelo administrador ainda.");
  }

  // Delegação de eventos (copiar link / filtrar)
  const wrap = document.getElementById("platformCards");
  if(!wrap) return;
  wrap.querySelectorAll(".btnCopyLink").forEach((btn)=>{
    btn.addEventListener("click", async ()=>{
      const link = btn.getAttribute("data-link") || "";
      if(!link) return;
      try{
        await navigator.clipboard.writeText(link);
        const old = btn.innerHTML;
        btn.innerHTML = '<i class="mdi mdi-check"></i> Copiado';
        setTimeout(()=> btn.innerHTML = old, 1100);
      }catch{
        alert("Não foi possível copiar automaticamente. Selecione o link e copie.");
      }
    });
  });
}

async function init(){
  const auth = await requireAuth().catch(()=>null);
  if(!auth?.ok){
    window.location.href = "entrar.html";
    return;
  }

  // logout button in sidebar
  document.getElementById("btnLogout")?.addEventListener("click", async ()=>{
    try{ await signOut(); }catch{}
    window.location.href = "entrar.html";
  });

  
  // Topbar (nome/email)
  const { user, profile } = auth;
  const nome = profile?.name || profile?.full_name || (user.email ? user.email.split("@")[0] : "Afiliado");
  document.getElementById("topbarNome") && (document.getElementById("topbarNome").textContent = nome);
  document.getElementById("dropNome") && (document.getElementById("dropNome").textContent = nome);
  document.getElementById("dropEmail") && (document.getElementById("dropEmail").textContent = user.email || "");

  window.__affiliateId = user.id;

  // when in "as affiliate" mode, show back to admin
  const navBack = document.getElementById("navBackToAdmin");
  if(navBack && (getQueryParam("as") === "affiliate")) navBack.style.display = "";

  await loadAndRender(user.id);
}

init().catch((e)=>{
  console.error(e);
  alert("Não foi possível carregar as plataformas agora.");
});