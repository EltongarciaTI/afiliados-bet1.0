import { signUpWithEmailPassword } from "./autenticacao.js";
import { supabase } from "./clienteSupabase.js";

/**
 * Landing (index.html) - Cadastro estilo AfiliaNex, integrado ao Supabase.
 * Regras:
 * - Cria usuário (auth.signUp)
 * - Atualiza profiles com campos extras
 * - Mostra a confirmação no próprio cadastro (sem redirecionar)
 */

function qs(id){ return document.getElementById(id); }

function showStep(n){
  const steps = Array.from(document.querySelectorAll(".form-step"));
  steps.forEach((el)=>el.classList.remove("active"));
  const target = qs(`step-${n}`);
  if (target) target.classList.add("active");

  // progress
  const pSteps = Array.from(document.querySelectorAll(".progress-step"));
  pSteps.forEach((s)=>s.classList.toggle("active", Number(s.dataset.step) <= n));
}

function setupPhoneMask(){
  const telefoneInput = qs("whatsapp");
  if(!telefoneInput) return;
  telefoneInput.addEventListener("input", (e)=>{
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 11) value = value.slice(0,11);
    if (value.length <= 10) value = value.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    else value = value.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
    e.target.value = value.trim();
  });
}

function setMsg(text, type="error"){
  const box = qs("cadastroMsg");
  if(!box) return;
  box.textContent = text || "";
  box.className = `form-message ${type}`;
  box.style.display = text ? "block" : "none";
}

function validateStep1(){
  const username = (qs("username")?.value || "").trim();
  const full_name = (qs("full_name")?.value || "").trim();
  const email = (qs("email")?.value || "").trim();
  const whatsapp = (qs("whatsapp")?.value || "").trim();
  const password = (qs("password")?.value || "");

  if(!username || !full_name || !email || !whatsapp || !password){
    setMsg("Preencha todos os campos obrigatórios do Passo 1.");
    return false;
  }
  if(password.length < 6){
    setMsg("A senha precisa ter pelo menos 6 caracteres.");
    return false;
  }
  setMsg("");
  return true;
}

function validateStep2(){
  const instagram = (qs("instagram")?.value || "").trim();
  const telegram = (qs("telegram")?.value || "").trim();
  const experience = (qs("experience")?.value || "").trim();
  // notes optional
  if(!instagram){
    setMsg("Informe seu Instagram (ou perfil principal).");
    return false;
  }
  if(!telegram){
    setMsg("Informe seu Telegram (user ou link).");
    return false;
  }
  if(!experience){
    setMsg("Conte rapidamente sua experiência.");
    return false;
  }
  setMsg("");
  return true;
}

async function onSubmit(e){
  e.preventDefault();
  if(!validateStep2()) return;

  const btn = qs("btnSubmitCadastro");
  if(btn) btn.disabled = true;

  try{
    const username = (qs("username")?.value || "").trim();
    const full_name = (qs("full_name")?.value || "").trim();
    const email = (qs("email")?.value || "").trim();
    const whatsapp = (qs("whatsapp")?.value || "").trim();
    const password = (qs("password")?.value || "");
    const instagram = (qs("instagram")?.value || "").trim();
    const telegram = (qs("telegram")?.value || "").trim();
    const experience = (qs("experience")?.value || "").trim();
    const notes = (qs("notes")?.value || "").trim();

    const res = await signUpWithEmailPassword(email, password);

    // Se confirmação por email estiver habilitada, não há session.
    if(res?.user?.id){
      const { error: e2 } = await supabase
        .from("profiles")
        .update({
          name: username,
          full_name,
          instagram,
          whatsapp,
          telegram,
          experience,
          notes
        })
        .eq("id", res.user.id);
      if(e2) throw e2;
    }

    // sucesso (fica na mesma tela)
    showStep(3);
    setMsg("");

    // rola para o bloco do cadastro para o usuário ver a confirmação
    try {
      document.getElementById("cadastro")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {}

  }catch(err){
    console.error(err);
    const m = String(err?.message || "");
    if(m.toLowerCase().includes("already registered")){
      setMsg("Esse email já tem conta. Clique em ENTRAR no topo para fazer login.");
    }else if(m.toLowerCase().includes("confirm")){
      setMsg("Conta criada! Confirme seu email e depois faça login.");
    }else{
      setMsg("Não foi possível criar a conta. Verifique os dados e tente novamente.");
    }
  }finally{
    if(btn) btn.disabled = false;
  }
}

function init(){
  // Expor next/prev pro HTML (template)
  window.nextStep = () => { if(validateStep1()) showStep(2); };
  window.prevStep = () => { showStep(1); };

  setupPhoneMask();
  showStep(1);

  const form = qs("form-cadastro");
  form?.addEventListener("submit", onSubmit);
}

document.addEventListener("DOMContentLoaded", init);
