// ============================================
// PhotoClass - Autenticação (tela de login)
// ============================================

import { auth } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("login-error");
const loginButton = document.getElementById("login-button");
const loginButtonText = document.getElementById("login-button-text");

// Se o professor já estiver logado, pula direto pro painel
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "dashboard.html";
  }
});

// Traduz os códigos de erro do Firebase para mensagens compreensíveis
function mensagemDeErro(codigoErro) {
  const mensagens = {
    "auth/invalid-email": "Digite um e-mail válido.",
    "auth/user-not-found": "Não encontramos uma conta com esse e-mail.",
    "auth/wrong-password": "Senha incorreta. Tente novamente.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um momento e tente de novo.",
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet."
  };
  return mensagens[codigoErro] || "Não foi possível entrar. Tente novamente.";
}

function mostrarErro(mensagem) {
  errorBox.textContent = mensagem;
  errorBox.hidden = false;
}

function esconderErro() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function definirCarregando(carregando) {
  loginButton.disabled = carregando;
  loginButtonText.textContent = carregando ? "Entrando..." : "Entrar";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  esconderErro();

  const email = emailInput.value.trim();
  const senha = passwordInput.value;

  if (!email || !senha) {
    mostrarErro("Preencha e-mail e senha.");
    return;
  }

  definirCarregando(true);

  try {
    await signInWithEmailAndPassword(auth, email, senha);
    // O redirecionamento acontece automaticamente pelo onAuthStateChanged acima
  } catch (erro) {
    mostrarErro(mensagemDeErro(erro.code));
    definirCarregando(false);
  }
});
