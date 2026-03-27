import { signInWithEmailPassword, signUpWithEmailPassword, requireAuth, signOut } from "./autenticacao.js";
import { supabase } from "./clienteSupabase.js";

function qs(id){ return document.getElementById(id); }


function getLoginBox(){
  return document.querySelector(".login-box") || document.querySelector(".auth-card") || document.body;
}

function renderPendingState(profile){
  const box = getLoginBox();
  if(!box) return;
  const name = profile?.full_name || profile?.name || "Afiliado";
  box.innerHTML = `
    <a aria-label="Voltar para a página inicial" class="login-logo" href="index.html">
      <img alt="Afiliados Bet" class="logo-img" src="assets/afnex/images/logo.png"/>
    </a>
    <h2 class="login-title">Cadastro em análise</h2>
    <p class="login-subtitle" style="margin-top:-6px;opacity:.9">
      Olá, <strong>${name}</strong>. Seu cadastro está aguardando aprovação do administrador.
    </p>
    <div class="pending-card" style="margin-top:14px;padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.03)">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div style="font-size:22px;line-height:1">⏳</div>
        <div>
          <div style="font-weight:600">Aguarde a liberação</div>
          <div style="opacity:.85;margin-top:4px">Assim que for aprovado, você poderá acessar o painel normalmente.</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button id="btnRefresh" class="btn-primary btn-login" type="button">Verificar novamente</button>
        <button id="btnLogout" class="btn-secondary" type="button" style="padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#fff">Sair</button>
      </div>
    </div>
    <div class="form-message" id="msg" style="margin-top:12px"></div>
  `;
  const btnRefresh = document.getElementById("btnRefresh");
  const btnLogout = document.getElementById("btnLogout");
  btnRefresh?.addEventListener("click", async ()=>{
    btnRefresh.disabled = true;
    try{
      const a = await requireAuth().catch(()=>null);
      if(a?.ok){
        if((a?.profile?.approval_status || "pending") === "approved"){
          window.location.href = "painel.html";
        }else{
          const msg = document.getElementById("msg");
          if(msg) msg.textContent = "Ainda não aprovado. Tente novamente em alguns instantes.";
        }
      }else{
        window.location.href = "entrar.html";
      }
    }finally{
      btnRefresh.disabled = false;
    }
  });
  btnLogout?.addEventListener("click", async ()=>{
    try{ await signOut(); }catch{}
    window.location.href = "entrar.html";
  });
}

function redirectAfterAuth(auth){
  // Afiliado aprovado -> painel.html
  if(auth?.profile?.role === "owner") { window.location.href = "painel-admin.html"; return; }
  // Se não estiver aprovado, mostra tela de "Cadastro em análise" usando o perfil real
  if((auth?.profile?.approval_status || "pending") !== "approved") { renderPendingState(auth?.profile || {}); return; }
  window.location.href = "painel.html";
}

async function init(){
  // Se já estiver logado, redireciona
  const auth = await requireAuth().catch(()=>null);
  if(auth?.ok){
    redirectAfterAuth(auth);
    return;
  }

  const form = qs("loginForm") || qs("adminLoginForm"); // compat
  const msg = qs("msg");
  const btn = qs("btnLogin");

  // Elementos opcionais (páginas diferentes)
  const toggle = qs("toggleMode");       // existe só em páginas que alternam login/cadastro
  const modeTitle = qs("modeTitle");
  const signupBox = qs("signupFields");  // container de campos extras

  let mode = "login"; // login | signup

  function safeSet(el, prop, val){
    if(!el) return;
    el[prop] = val;
  }

  function render(){
    // Se a página não tem toggle/cadastro, mantém login simples
    const hasToggle = !!toggle;
    const hasSignup = !!signupBox;

    if(!hasToggle && !hasSignup){
      safeSet(modeTitle, "textContent", "Entrar");
      safeSet(btn, "textContent", "Entrar");
      return;
    }

    if(mode === "login"){
      safeSet(modeTitle, "textContent", "Entrar");
      safeSet(btn, "textContent", "Entrar");
      if(toggle) toggle.innerHTML = 'Não tem conta? <a href="#" class="fw-semibold">Criar conta</a>';
      if(signupBox) signupBox.style.display = "none";
    }else{
      safeSet(modeTitle, "textContent", "Criar conta");
      safeSet(btn, "textContent", "Criar conta");
      if(toggle) toggle.innerHTML = 'Já tem conta? <a href="#" class="fw-semibold">Entrar</a>';
      if(signupBox) signupBox.style.display = "block";
    }
  }

  if(toggle){
    toggle.addEventListener("click", (e)=>{
      e.preventDefault();
      mode = (mode === "login") ? "signup" : "login";
      if(msg) msg.textContent = "";
      render();
    });
  }

  render();

  form?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(msg) msg.textContent = "";
    if(btn) btn.disabled = true;

    try{
      const email = (qs("email")?.value || "").trim();
      const password = qs("password")?.value || "";

      if(!email || !password){
        if(msg) msg.textContent = "Preencha email e senha.";
        return;
      }

      if(mode === "login"){
        await signInWithEmailPassword(email, password);
        const a = await requireAuth().catch(()=>null);
        if(a?.ok) redirectAfterAuth(a);
        else window.location.href = "painel.html";
        return;
      }

      // Signup (apenas se essa tela suportar cadastro)
      const username = (qs("username")?.value || "").trim();
      const full_name = (qs("full_name")?.value || "").trim();
      const instagram = (qs("instagram")?.value || "").trim();
      const whatsapp = (qs("whatsapp")?.value || "").trim();
      const telegram = (qs("telegram")?.value || "").trim();
      const experience = (qs("experience")?.value || "").trim();
      const notes = (qs("notes")?.value || "").trim();

      if(!username || !full_name || !instagram || !whatsapp || !telegram || !experience){
        if(msg) msg.textContent = "Preencha: Username, Nome completo, Instagram, WhatsApp, Telegram e Experiência.";
        return;
      }

      const res = await signUpWithEmailPassword(email, password);

      // Se confirmação por email estiver ativa
      if(res?.user && !res?.session){
        if(msg) msg.textContent = "Conta criada! Confira seu email para confirmar e depois faça login.";
        mode = "login";
        render();
        return;
      }

      // Auto-login (quando confirmações estão desativadas)
      const me = res?.user;
      if(me?.id){
        const { error: e2 } = await supabase
          .from("profiles")
          .update({ name: username, full_name, instagram, whatsapp, telegram, experience, notes })
          .eq("id", me.id);
        if(e2) throw e2;
      }
      renderPendingState({ full_name });

    }catch(err){
      console.error(err);
      const m = String(err?.message || "").toLowerCase();

      if(m.includes("already registered")){
        if(msg) msg.textContent = "Esse email já tem conta. Faça login.";
        mode = "login";
        render();
        return;
      }
      if(m.includes("invalid login")) { if(msg) msg.textContent = "Email ou senha inválidos."; }
      else if(m.includes("email") && m.includes("confirm")) { if(msg) msg.textContent = "Confirme seu email para entrar."; }
      else { if(msg) msg.textContent = (mode === "login") ? "Não foi possível entrar. Verifique email/senha." : "Não foi possível criar a conta. Verifique o email e tente outra senha."; }
    }finally{
      if(btn) btn.disabled = false;
    }
  });
}

init();
