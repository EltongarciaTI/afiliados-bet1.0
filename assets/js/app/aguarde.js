import { requireAuth, signOut } from "./autenticacao.js";

const $ = (id) => document.getElementById(id);

function safe(s){ return (s ?? "").toString(); }

async function init(){
  const auth = await requireAuth().catch(()=>null);
  if(!auth?.ok){
    window.location.href = "entrar.html";
    return;
  }

  const email = safe(auth.profile?.email || auth.user?.email);
  const status = safe(auth.profile?.approval_status || "pending");

  const who = $("who");
  if(who) who.textContent = email ? `Logado como: ${email} • status: ${status}` : `Status: ${status}`;

  $("btnLogout")?.addEventListener("click", async ()=>{
    try{ await signOut(); }catch(e){ console.error(e); }
    window.location.href = "entrar.html";
  });
}

init();
