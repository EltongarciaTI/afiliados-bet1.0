import { requireAuth, signOut } from "./autenticacao.js";
import { supabase } from "./clienteSupabase.js";
import { TELEGRAM_HELP_URL } from "./config.js";

function qs(id){ return document.getElementById(id); }

function showMsg(id, text){
  const el = qs(id);
  if(!el) return;
  el.textContent = text || "";
  el.style.display = text ? "block" : "none";
}

function safeDate(iso){
  if(!iso) return "-";
  try{ return new Date(iso).toLocaleDateString("pt-BR"); }catch{ return "-"; }
}

function badgeStatus(s){
  const v = String(s || "").toLowerCase();
  if(v === "approved") return `<span class="badge bg-success badge-status">Aprovado</span>`;
  if(v === "rejected") return `<span class="badge bg-danger badge-status">Recusado</span>`;
  return `<span class="badge bg-warning badge-status">Pendente</span>`;
}

async function loadHouses(){
  const tbody = document.querySelector("#housesTable tbody");
  if(tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Carregando...</td></tr>`;

  const { data, error } = await supabase
    .from("houses")
    .select("id, nome, link, comissao_modelo, baseline, cpa, rev, ativo, created_at")
    .order("created_at", { ascending: false });
  if(error) throw error;

  const rows = data || [];
  if(!tbody) return;
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Nenhuma plataforma cadastrada.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((h)=>{
    const modelo = String(h.comissao_modelo || "cpa").toUpperCase();
    const cpa = Number(h.cpa || 0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
    const rev = `${Number(h.rev || 0)}%`;
    const ativo = h.ativo ? `<span class="badge bg-success">Sim</span>` : `<span class="badge bg-secondary">Não</span>`;
    return `
      <tr>
        <td>
          <div class="fw-semibold">${h.nome || "-"}</div>
          <div class="small text-muted">${h.link ? `<a href="${h.link}" target="_blank" rel="noopener noreferrer">Abrir link</a>` : "-"}</div>
        </td>
        <td>${modelo}</td>
        <td>${cpa}</td>
        <td>${rev}</td>
        <td>${ativo}</td>
        <td>
          <button class="btn btn-outline-primary btn-sm action-btn" data-action="edit" data-id="${h.id}"><i class="mdi mdi-pencil"></i></button>
          <button class="btn btn-outline-danger btn-sm action-btn" data-action="del" data-id="${h.id}"><i class="mdi mdi-delete"></i></button>
        </td>
      </tr>
    `;
  }).join("");

  // actions
  tbody.querySelectorAll("button[data-action]").forEach((btn)=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-action");
      if(!id) return;
      if(act === "edit"){
        const h = rows.find(r=>r.id === id);
        if(h) openHouseModal(h);
      }
      if(act === "del"){
        if(!confirm("Remover esta plataforma?")) return;
        // Remoção com cascata (solicitações + casas vinculadas)
        // 1) remove solicitações
        await supabase.from("affiliate_house_requests").delete().eq("house_id", id);

        // 2) tenta remover vínculos por house_id (se a coluna existir)
        const delById = await supabase.from("affiliate_houses").delete().eq("house_id", id);
        // fallback: se a coluna não existir, remove por nome (house_name)
        if(delById?.error && String(delById.error.message||"").includes("house_id")){
          const h = rows.find(r=>r.id === id);
          if(h?.nome){
            await supabase.from("affiliate_houses").delete().eq("house_name", h.nome);
          }
        }

        // 3) remove do catálogo
        const { error } = await supabase.from("houses").delete().eq("id", id);
        if(error) throw error;

        await loadHouses();
      }
    });
  });
}

function openHouseModal(house){
  // house opcional: se tiver, é edição
  showMsg("houseModalMsg", "");
  qs("houseId").value = house?.id || "";
  qs("houseNome").value = house?.nome || "";
  qs("houseLink").value = house?.link || "";
  qs("houseModelo").value = String(house?.comissao_modelo || "cpa").toLowerCase();
  qs("houseBaseline").value = Number(house?.baseline || 0);
  qs("houseCpa").value = Number(house?.cpa || 0);
  qs("houseRev").value = Number(house?.rev || 0);
  qs("houseAtivo").checked = !!(house?.ativo ?? true);
  qs("houseModalTitle").textContent = house?.id ? "Editar plataforma" : "Nova plataforma";
  window.$("#houseModal").modal("show");
}

async function saveHouse(){
  showMsg("houseModalMsg", "");
  const id = (qs("houseId").value || "").trim();
  const nome = (qs("houseNome").value || "").trim();
  const link = (qs("houseLink").value || "").trim();
  const comissao_modelo = (qs("houseModelo").value || "cpa").trim();
  const baseline = Number(qs("houseBaseline").value || 0);
  const cpa = Number(qs("houseCpa").value || 0);
  const rev = Number(qs("houseRev").value || 0);
  const ativo = !!qs("houseAtivo").checked;

  if(!nome){
    showMsg("houseModalMsg", "Informe o nome da plataforma.");
    return;
  }

  const payload = { nome, link: link || null, comissao_modelo, baseline, cpa, rev, ativo };
  const btn = qs("btnSaveHouse");
  if(btn) btn.disabled = true;
  try{
    if(id){
      const { error } = await supabase.from("houses").update(payload).eq("id", id);
      if(error) throw error;
    }else{
      const { error } = await supabase.from("houses").insert(payload);
      if(error) throw error;
    }
    window.$("#houseModal").modal("hide");
    await loadHouses();
  }catch(e){
    console.error(e);
    const msg = (e && (e.message || e.error_description)) ? `Não foi possível salvar: ` : "Não foi possível salvar. Verifique se você rodou o SQL_PLATAFORMAS_REQUESTS.sql e se o owner tem permissão.";
    showMsg("houseModalMsg", msg);
  }finally{
    if(btn) btn.disabled = false;
  }
}

async function loadRequests(){
  const tbody = document.querySelector("#requestsTable tbody");
  if(tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Carregando...</td></tr>`;

  const { data, error } = await supabase
    .from("affiliate_house_requests")
    .select("id, affiliate_id, house_id, house_name, house_link, status, created_at")
    .order("created_at", { ascending: false });
  if(error) throw error;

  const reqs = data || [];
  const ids = [...new Set(reqs.map(r=>r.affiliate_id).filter(Boolean))];
  let profilesById = {};
  if(ids.length){
    const { data: ps, error: pe } = await supabase
      .from("profiles")
      .select("id, name, full_name, email")
      .in("id", ids);
    if(pe) throw pe;
    (ps || []).forEach(p=>{ profilesById[p.id] = p; });
  }

  if(!tbody) return;
  if(!reqs.length){
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Nenhuma solicitação no momento.</td></tr>`;
    return;
  }

  tbody.innerHTML = reqs.map((r)=>{
    const p = profilesById[r.affiliate_id] || {};
    const nome = (p.full_name || p.name || "Afiliado");
    const email = p.email || "";
    const af = email ? `${nome}<div class="small text-muted">${email}</div>` : nome;
    const plat = r.house_link ? `<a href="${r.house_link}" target="_blank" rel="noopener noreferrer">${r.house_name}</a>` : (r.house_name || "-");
	    const st = String(r.status||"").toLowerCase();
	    const actions = st === "pending"
	      ? `
	        <button class="btn btn-success btn-sm action-btn" title="Aprovar" data-action="approve" data-id="${r.id}"><i class="mdi mdi-check"></i></button>
	        <button class="btn btn-outline-danger btn-sm action-btn" title="Recusar" data-action="reject" data-id="${r.id}"><i class="mdi mdi-close"></i></button>
	      `
	      : (st === "approved" ? `
	        <button class="btn btn-outline-danger btn-sm action-btn" title="Apagar casa do afiliado" data-action="delete_house" data-id="${r.id}"><i class="mdi mdi-trash-can-outline"></i></button>
	      ` : `<span class="text-muted">-</span>`);
    return `
      <tr>
        <td>${af}</td>
        <td>${plat}</td>
        <td>${badgeStatus(r.status)}</td>
        <td>${safeDate(r.created_at)}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("button[data-action]").forEach((btn)=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-action");
      const row = reqs.find(x=>x.id === id);
      if(!row) return;
	      if(act === "reject"){
        if(!confirm("Recusar esta solicitação?")) return;
        const { error } = await supabase.from("affiliate_house_requests").update({ status: "rejected" }).eq("id", row.id);
        if(error) throw error;
        await loadRequests();
        return;
      }
	      if(act === "delete_house"){
	        if(!confirm("Apagar a casa deste afiliado? (isso remove o vínculo aprovado)")) return;
	        // remove vínculo na affiliate_houses pelo house_id + affiliate_id
        // remove vínculo na affiliate_houses
        // 1) tenta por house_id (se existir e não for null)
        let delRes = null;

        const hid = (row.house_id && String(row.house_id).trim().toLowerCase() !== 'null') ? String(row.house_id).trim() : '';
        if (hid) {
          delRes = await supabase
            .from("affiliate_houses")
            .delete()
            .eq("affiliate_id", row.affiliate_id)
            .eq("house_id", hid);
        } else {
          // 2) fallback: tenta por nome/link (caso house_id não tenha sido salvo na request)
          delRes = await supabase
            .from("affiliate_houses")
            .delete()
            .eq("affiliate_id", row.affiliate_id)
            .eq("house_name", row.house_name || "");
          // se ainda não deletou, tenta por link
          if (delRes?.error && row.house_link) {
            delRes = await supabase
              .from("affiliate_houses")
              .delete()
              .eq("affiliate_id", row.affiliate_id)
              .eq("house_link", row.house_link);
          }
        }

        if (delRes?.error) throw delRes.error;
        // remove a solicitação da lista (apaga do banco)
        const { error: re } = await supabase.from("affiliate_house_requests").delete().eq("id", row.id);
        if (re) throw re;
        await loadRequests();
	        return;
	      }
      if(act === "approve"){
        openApproveModal(row);
      }
    });
  });
}

function openApproveModal(req){
  showMsg("approveModalMsg", "");
  qs("reqId").value = req.id;
  qs("reqAffiliateId").value = req.affiliate_id;
  qs("reqHouseName").value = req.house_name || "";
  qs("reqHouseLink").value = req.house_link || "";
  qs("reqAffiliateLink").value = "";
  qs("reqCommissionAvailable").value = 0;
  window.$("#approveModal").modal("show");
}

async function confirmApprove(){
  showMsg("approveModalMsg", "");
  const reqId = (qs("reqId").value || "").trim();
  const affiliate_id = (qs("reqAffiliateId").value || "").trim();
  const house_name = (qs("reqHouseName").value || "").trim();
  const house_link = (qs("reqHouseLink").value || "").trim();
  const affiliate_link = (qs("reqAffiliateLink").value || "").trim();
  const commission_available = Number(qs("reqCommissionAvailable").value || 0);

  if(!affiliate_link){
    showMsg("approveModalMsg", "Informe o link do afiliado.");
    return;
  }

  const btn = qs("btnConfirmApprove");
  if(btn) btn.disabled = true;
  try{
    // tenta pegar config padrão do catálogo
    let cfg = null;
    const { data: h, error: he } = await supabase
      .from("houses")
      .select("comissao_modelo, baseline, cpa, rev")
      .eq("nome", house_name)
      .maybeSingle();
    if(!he) cfg = h;

    const payload = {
      affiliate_id,
      house_name,
      house_link: house_link || null,
      affiliate_link,
      comissao_modelo: (cfg?.comissao_modelo || "cpa"),
      baseline: Number(cfg?.baseline || 0),
      cpa: Number(cfg?.cpa || 0),
      rev: Number(cfg?.rev || 0),
      commission_available,
      is_active: true
    };

    const { error: ie } = await supabase.from("affiliate_houses").insert(payload);
    if(ie) throw ie;

    const { error: ue } = await supabase.from("affiliate_house_requests").update({ status: "approved" }).eq("id", reqId);
    if(ue) throw ue;

    window.$("#approveModal").modal("hide");
    await loadRequests();
  }catch(e){
    console.error(e);
    const msg = (e && (e.message || e.error_description)) ? `Não foi possível aprovar: ` : "Não foi possível aprovar. Verifique as policies (owner) e se a tabela affiliate_houses existe (SQL_MULTICASAS_VINI.sql).";
    showMsg("approveModalMsg", msg);
  }finally{
    if(btn) btn.disabled = false;
  }
}

async function init(){
  const auth = await requireAuth({ role: "owner" });
  if(!auth.ok){
    window.location.href = "entrar-admin.html";
    return;
  }

  // suporte
  const helpLink = qs("btnHelp");
  if(helpLink) helpLink.href = TELEGRAM_HELP_URL;

  qs("btnLogoutTop")?.addEventListener("click", async (e)=>{
    e.preventDefault();
    await signOut();
    window.location.href = "entrar-admin.html";
  });

  qs("btnAddHouse")?.addEventListener("click", ()=> openHouseModal(null));
  qs("btnSaveHouse")?.addEventListener("click", saveHouse);

  qs("btnRefreshRequests")?.addEventListener("click", async ()=>{
    await loadRequests();
  });

  qs("btnConfirmApprove")?.addEventListener("click", confirmApprove);

  await loadHouses();
  await loadRequests();
}

document.addEventListener("DOMContentLoaded", init);