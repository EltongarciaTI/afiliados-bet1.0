import { signInWithEmailPassword, requireAuth } from "./autenticacao.js";

function qs(id){ return document.getElementById(id); }

async function init(){
  const auth = await requireAuth().catch(()=>null);
  if(auth?.ok){
    // if owner already, go admin, else go dashboard
    if(auth.profile?.role === "owner") window.location.href="painel-admin.html";
    else window.location.href="index.html";
    return;
  }

  const form = qs("adminLoginForm");
  const msg = qs("msg");
  const btn = qs("btnLogin");

  form?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    msg.textContent = "";
    btn.disabled = true;

    try{
      const email = qs("email").value.trim();
      const password = qs("password").value;
      await signInWithEmailPassword(email, password);

      const check = await requireAuth({ role: "owner" });
      if(!check.ok){
        msg.textContent = "Esse usuário não tem permissão de admin (role != owner).";
        return;
      }
      window.location.href="painel-admin.html";
    }catch(err){
      console.error(err);
      msg.textContent = "Não foi possível entrar no admin.";
    }finally{
      btn.disabled = false;
    }
  });
}

init();
