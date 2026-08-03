// ============================================
// PhotoClass - Controle de Papéis (Admin / Professor)
// ============================================
// Por enquanto, quem é admin é definido por uma lista fixa de e-mails.
// Só essas contas veem o botão de alternar entre visão de Admin e
// visão de Professor, e o menu "Professores" - as demais professoras
// sempre usam a visão de Professor, restrita às turmas liberadas
// pra elas (coleção "professores" no Firestore).

import { db } from "./firebase-config.js?v=20260728i";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const ADMIN_EMAILS = [
  "luciano.galdino@colegioarena.com.br"
];

export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(email);
}

export function getModoVisualizacao() {
  return sessionStorage.getItem("pc_modo_visualizacao") || "admin";
}

export function setModoVisualizacao(modo) {
  sessionStorage.setItem("pc_modo_visualizacao", modo);
}

// Retorna true só se a conta é admin E está com a visão de Admin ativa
export function estaEmModoAdmin(email) {
  return isAdminEmail(email) && getModoVisualizacao() === "admin";
}

// Configura o botão de alternância no header, se a conta for admin
export function configurarAlternadorVisao(email) {
  const botao = document.getElementById("view-toggle");
  if (!botao) return;

  if (!isAdminEmail(email)) {
    botao.hidden = true;
    return;
  }

  botao.hidden = false;
  atualizarTextoBotao(botao);

  botao.addEventListener("click", () => {
    const modoAtual = getModoVisualizacao();
    const novoModo = modoAtual === "admin" ? "professor" : "admin";
    setModoVisualizacao(novoModo);
    window.location.reload();
  });
}

function atualizarTextoBotao(botao) {
  const modo = getModoVisualizacao();
  botao.textContent = modo === "admin" ? "👤 Ver como Professor" : "🛠 Ver como Admin";
}

// ---------- Turmas permitidas por professora ----------

// Retorna a lista de turmas que essa conta pode acessar.
// null = acesso total (é admin). [] = ainda sem nenhuma turma liberada.
export async function obterTurmasPermitidas(email) {
  if (isAdminEmail(email)) return null;

  try {
    const snap = await getDoc(doc(db, "professores", email));
    if (!snap.exists()) return [];
    return snap.data().turmas || [];
  } catch (erro) {
    console.error(erro);
    return [];
  }
}

// Mostra o link "Professores" no menu só quando está de fato no
// modo Admin (some se a conta admin estiver com "Ver como Professor" ativo)
export function configurarNavProfessores(email) {
  const link = document.getElementById("nav-professores");
  if (!link) return;
  link.hidden = !estaEmModoAdmin(email);
}

// Liga o botão hambúrguer do menu mobile (abre/fecha a navegação
// quando a tela é estreita demais pra mostrar os links direto)
export function configurarMenuMobile() {
  const botao = document.getElementById("mobile-menu-toggle");
  const nav = document.querySelector(".app-header-nav");
  if (!botao || !nav) return;

  botao.addEventListener("click", () => nav.classList.toggle("aberto"));

  // Fecha o menu ao clicar em qualquer link dele
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => nav.classList.remove("aberto"));
  });

  // Fecha se clicar fora do menu
  document.addEventListener("click", (evento) => {
    if (!nav.contains(evento.target) && evento.target !== botao) {
      nav.classList.remove("aberto");
    }
  });
}
