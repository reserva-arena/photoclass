// ============================================
// PhotoClass - Controle de Papéis (Admin / Professor)
// ============================================
// Por enquanto, quem é admin é definido por uma lista fixa de e-mails.
// Só essas contas veem o botão de alternar entre visão de Admin e
// visão de Professor, e o menu "Professores" - as demais professoras
// sempre usam a visão de Professor, restrita às turmas liberadas
// pra elas (coleção "professores" no Firestore).

import { db } from "./firebase-config.js?v=20260812i";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { updatePassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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

// ---------- Troca de senha obrigatória no primeiro acesso ----------
// Toda professora nova recebe a senha inicial "123456" (ver professores.js).
// Aqui a gente confere se essa conta ainda está com a flag de senha
// temporária no Firestore e, se estiver, bloqueia o app inteiro atrás de
// uma tela pedindo pra ela definir uma senha própria antes de continuar.
// Chamado sempre em dashboard.js, que é a primeira tela depois do login.
export async function bloquearSeSenhaTemporaria(user) {
  if (isAdminEmail(user.email)) return; // conta admin nunca usa senha temporária

  let precisaTrocar = false;
  try {
    const snap = await getDoc(doc(db, "professores", user.email));
    precisaTrocar = snap.exists() && snap.data().senhaTemporaria === true;
  } catch (erro) {
    console.error("Não foi possível verificar a senha temporária:", erro);
    return; // se a checagem falhar, não trava o acesso - melhor deixar entrar
  }

  if (precisaTrocar) mostrarOverlayTrocaSenha(user);
}

function mostrarOverlayTrocaSenha(user) {
  const overlay = document.createElement("div");
  overlay.className = "senha-temp-overlay";
  overlay.innerHTML = `
    <div class="senha-temp-card">
      <h2>Defina sua senha</h2>
      <p class="card-subtitle">Você entrou com a senha inicial fornecida pela escola. Por segurança, defina agora uma senha só sua (mínimo 6 caracteres) antes de continuar.</p>
      <form id="senha-temp-form" novalidate>
        <div class="field">
          <label for="senha-temp-nova">Nova senha</label>
          <input type="password" id="senha-temp-nova" autocomplete="new-password" required minlength="6" placeholder="Mínimo 6 caracteres">
        </div>
        <div class="field">
          <label for="senha-temp-confirmar">Confirmar nova senha</label>
          <input type="password" id="senha-temp-confirmar" autocomplete="new-password" required minlength="6" placeholder="Digite de novo">
        </div>
        <p id="senha-temp-erro" class="error-message" role="alert" hidden></p>
        <button type="submit" id="senha-temp-botao" class="btn-primary">Salvar nova senha</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const form = overlay.querySelector("#senha-temp-form");
  const erroBox = overlay.querySelector("#senha-temp-erro");
  const botao = overlay.querySelector("#senha-temp-botao");

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    erroBox.hidden = true;

    const nova = overlay.querySelector("#senha-temp-nova").value;
    const confirmar = overlay.querySelector("#senha-temp-confirmar").value;

    if (nova.length < 6) {
      erroBox.textContent = "A senha precisa ter pelo menos 6 caracteres.";
      erroBox.hidden = false;
      return;
    }
    if (nova !== confirmar) {
      erroBox.textContent = "As senhas digitadas não são iguais.";
      erroBox.hidden = false;
      return;
    }
    if (nova === "123456") {
      erroBox.textContent = "Escolha uma senha diferente da senha inicial.";
      erroBox.hidden = false;
      return;
    }

    botao.disabled = true;
    botao.textContent = "Salvando...";

    try {
      // A troca de senha em si (Firebase Auth) é o que realmente importa
      // pra segurança - isso acontece primeiro e sozinho, fora do try
      // de gravar a "flag" no Firestore. Se der erro AQUI, a senha não
      // mudou de verdade e a gente trava a professora com uma mensagem
      // clara. Se der erro só depois (gravando a flag), a senha já mudou
      // e não faz sentido travar nem assustar ela com "tente novamente".
      await updatePassword(user, nova);

      try {
        await setDoc(doc(db, "professores", user.email), { senhaTemporaria: false }, { merge: true });
      } catch (erroFlag) {
        // Não bloqueia o acesso - a senha já foi trocada de verdade.
        // Provavelmente as regras do Firestore não deixam a professora
        // escrever no próprio documento em "professores" ainda; até isso
        // ser ajustado, essa tela vai voltar a aparecer no próximo login,
        // mas sem impedir o uso do app.
        console.warn("Senha trocada com sucesso, mas não consegui gravar a confirmação no Firestore:", erroFlag);
      }

      overlay.remove();
    } catch (erro) {
      console.error(erro);
      if (erro.code === "auth/requires-recent-login") {
        erroBox.textContent = "Por segurança, saia e entre de novo com a senha inicial (123456) antes de trocar a senha.";
      } else if (erro.code === "auth/weak-password") {
        erroBox.textContent = "Senha muito fraca. Use pelo menos 6 caracteres.";
      } else {
        erroBox.textContent = "Não foi possível salvar a nova senha. Tente novamente.";
      }
      erroBox.hidden = false;
      botao.disabled = false;
      botao.textContent = "Salvar nova senha";
    }
  });
}
