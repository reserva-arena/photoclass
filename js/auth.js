// ============================================
// PhotoClass - Autenticação (tela de login)
// ============================================

import { auth } from "./firebase-config.js?v=20260727d";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("login-error");
const successBox = document.getElementById("login-success");
const loginButton = document.getElementById("login-button");
const loginButtonText = document.getElementById("login-button-text");
const forgotPasswordButton = document.getElementById("forgot-password-button");

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
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet.",
    "auth/missing-email": "Digite seu e-mail primeiro."
  };
  return mensagens[codigoErro] || "Não foi possível entrar. Tente novamente.";
}

function mostrarErro(mensagem) {
  successBox.hidden = true;
  errorBox.textContent = mensagem;
  errorBox.hidden = false;
}

function mostrarSucesso(mensagem) {
  errorBox.hidden = true;
  successBox.textContent = mensagem;
  successBox.hidden = false;
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

forgotPasswordButton.addEventListener("click", async () => {
  esconderErro();
  successBox.hidden = true;

  const email = emailInput.value.trim();
  if (!email) {
    mostrarErro("Digite seu e-mail no campo acima e clique de novo.");
    emailInput.focus();
    return;
  }

  forgotPasswordButton.disabled = true;
  forgotPasswordButton.textContent = "Enviando...";

  try {
    await sendPasswordResetEmail(auth, email);
    mostrarSucesso("E-mail enviado! Confira sua caixa de entrada (e o spam) pra criar uma nova senha.");
  } catch (erro) {
    // Por segurança, não revela se o e-mail existe ou não
    mostrarSucesso("Se esse e-mail estiver cadastrado, você vai receber um link pra criar uma nova senha.");
  } finally {
    forgotPasswordButton.disabled = false;
    forgotPasswordButton.textContent = "Esqueci minha senha";
  }
});
