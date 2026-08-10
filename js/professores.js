// ============================================
// PhotoClass - Gerenciar Professoras e Turmas
// ============================================
// Tela restrita ao Admin: cria o login da professora (e-mail/senha)
// automaticamente e define quais turmas ela pode acessar - tudo
// direto pelo app, sem precisar abrir o Firebase Console.

import { auth, db, firebaseConfig } from "./firebase-config.js?v=20260804f";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  getAuth,
  createUserWithEmailAndPassword,
  signOut as signOutSecundario
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, estaEmModoAdmin } from "./roles.js?v=20260804f";
import { TURMAS, NOMES_SEGMENTO } from "./turmas.js?v=20260804f";
import { aprenderComFoto } from "./aprendizado.js?v=20260804f";
import { garantirTokenAcesso, obterOuCriarPasta, obterPastaRaizDaTurma, obterModeloDaTurma, concederAcessoEditorPasta, excluirPasta, adicionarMembroDriveCompartilhado, definirEmailUsuario } from "./drive-upload.js?v=20260804f";

// Instância secundária do Firebase, só pra criar o login da professora
// sem afetar a sessão do admin logado no app principal
const appSecundario = initializeApp(firebaseConfig, "criar-professora");
const authSecundario = getAuth(appSecundario);

// Gera uma senha temporária aleatória (a professora nunca vai usar essa -
// ela cria a senha dela mesma pelo e-mail de acesso)
function gerarSenhaTemporaria() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

// ---------- Elementos ----------
const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

const formTitle = document.getElementById("form-title");
const form = document.getElementById("professor-form");
const emailInput = document.getElementById("email-input");
const turmasChecklist = document.getElementById("turmas-checklist");
const cancelEditButton = document.getElementById("cancel-edit-button");
const formError = document.getElementById("form-error");
const formSuccess = document.getElementById("form-success");
const submitButton = document.getElementById("submit-button");
const submitButtonText = document.getElementById("submit-button-text");

const professoresList = document.getElementById("professores-list");
const professoresCount = document.getElementById("professores-count");

let emailEmEdicao = null; // null = novo cadastro; senão, e-mail sendo editado
const professoresCache = new Map(); // email -> { turmas }

// ---------- Proteção da página (só admin) ----------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  if (!estaEmModoAdmin(user.email)) {
    window.location.href = "dashboard.html";
    return;
  }

  userEmailLabel.textContent = user.email;
  definirEmailUsuario(user.email);
  configurarAlternadorVisao(user.email);
  configurarMenuMobile();
  configurarNavProfessores(user.email);
  preencherChecklistTurmas();
  preencherSelectLimparTurma();
  carregarProfessores();
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Monta a checklist de turmas, agrupada por segmento ----------
function preencherChecklistTurmas() {
  const segmentos = [...new Set(TURMAS.map((t) => t.segmento))];
  turmasChecklist.innerHTML = "";

  segmentos.forEach((segmento) => {
    const label = document.createElement("p");
    label.className = "turmas-checklist-group-label";
    label.textContent = NOMES_SEGMENTO[segmento] || segmento;
    turmasChecklist.appendChild(label);

    TURMAS.filter((t) => t.segmento === segmento).forEach((turma) => {
      const linha = document.createElement("label");
      linha.className = "turmas-checklist-option";
      linha.innerHTML = `<input type="checkbox" value="${turma.nome}"> ${turma.nome}`;
      turmasChecklist.appendChild(linha);
    });
  });
}

function turmasMarcadas() {
  return [...turmasChecklist.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value);
}

function marcarTurmas(turmas) {
  turmasChecklist.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.checked = turmas.includes(input.value);
  });
}

// ---------- Utilitários de mensagem ----------
function mostrarErro(mensagem) {
  formSuccess.hidden = true;
  formError.textContent = mensagem;
  formError.hidden = false;
}

function mostrarSucesso(mensagem) {
  formError.hidden = true;
  formSuccess.textContent = mensagem;
  formSuccess.hidden = false;
}

function esconderMensagens() {
  formError.hidden = true;
  formSuccess.hidden = true;
}

// ---------- Modo edição ----------
function entrarModoEdicao(email) {
  const dados = professoresCache.get(email);
  if (!dados) return;

  emailEmEdicao = email;
  emailInput.value = email;
  emailInput.disabled = true; // não dá pra trocar o e-mail de um registro existente
  marcarTurmas(dados.turmas || []);

  formTitle.textContent = `Editando turmas de: ${email}`;
  submitButtonText.textContent = "Salvar alterações";
  cancelEditButton.hidden = false;
  esconderMensagens();

  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function sairModoEdicao() {
  emailEmEdicao = null;
  form.reset();
  emailInput.disabled = false;
  marcarTurmas([]);

  formTitle.textContent = "Liberar turma(s) para uma professora";
  submitButtonText.textContent = "Salvar";
  cancelEditButton.hidden = true;
  esconderMensagens();
}

cancelEditButton.addEventListener("click", sairModoEdicao);

// ---------- Salvar (criar ou editar) ----------
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  esconderMensagens();

  const email = emailEmEdicao || emailInput.value.trim().toLowerCase();
  const turmas = turmasMarcadas();

  if (!email) {
    mostrarErro("Informe o e-mail da professora.");
    return;
  }
  if (turmas.length === 0) {
    mostrarErro("Marque ao menos uma turma.");
    return;
  }

  submitButton.disabled = true;
  submitButtonText.textContent = emailEmEdicao ? "Salvando..." : "Criando login...";

  try {
    let loginCriadoAgora = false;

    // Só tenta criar o login se for um cadastro novo (não em edição)
    if (!emailEmEdicao) {
      try {
        await createUserWithEmailAndPassword(authSecundario, email, gerarSenhaTemporaria());
        await signOutSecundario(authSecundario); // limpa a sessão secundária, sem afetar o admin
        loginCriadoAgora = true;
      } catch (erroAuth) {
        if (erroAuth.code === "auth/email-already-in-use") {
          // Login já existia (criado antes pelo Firebase Console, por exemplo) - segue o jogo
        } else if (erroAuth.code === "auth/invalid-email") {
          throw new Error("E-mail inválido.");
        } else {
          throw new Error("Não foi possível criar o login. Tente novamente.");
        }
      }
    }

    submitButtonText.textContent = "Salvando turmas...";
    await setDoc(
      doc(db, "professores", email),
      {
        turmas,
        atualizadoEm: serverTimestamp(),
        ...(emailEmEdicao ? {} : { criadoEm: serverTimestamp() })
      },
      { merge: true }
    );

    // Dá acesso ao Drive certo pra cada turma dela. No modelo novo
    // ("pasta-comum"), o acesso é só na pasta daquela turma específica -
    // ela não vê as outras turmas da mesma conta. No modelo antigo
    // ("drive-compartilhado", ainda em uso só nos Anos Iniciais até
    // migrarmos), o acesso é ao Drive inteiro (todas as turmas dele).
    let driveOk = true;
    try {
      submitButtonText.textContent = "Liberando acesso ao Drive...";
      const accessToken = await garantirTokenAcesso();
      const drivesCompartilhadosJaFeitos = new Set(); // evita repetir a mesma concessão de drive inteiro

      for (const turma of turmas) {
        const raizId = obterPastaRaizDaTurma(turma);
        const modelo = obterModeloDaTurma(turma);

        if (modelo === "pasta-comum") {
          submitButtonText.textContent = `Liberando acesso a ${turma}...`;
          const pastaTurma = await obterOuCriarPasta(turma, raizId, accessToken);
          await concederAcessoEditorPasta(pastaTurma, email, accessToken);
        } else if (!drivesCompartilhadosJaFeitos.has(raizId)) {
          await adicionarMembroDriveCompartilhado(raizId, email, accessToken);
          drivesCompartilhadosJaFeitos.add(raizId);
        }
      }
    } catch (erroDrive) {
      console.error("Erro ao dar acesso ao Drive:", erroDrive);
      driveOk = false;
    }

    // Manda o e-mail de acesso automaticamente pra quem acabou de ser criada
    if (loginCriadoAgora) {
      try {
        await sendPasswordResetEmail(auth, email);
      } catch {
        // Se falhar o envio do e-mail, não bloqueia o cadastro - dá pra reenviar depois
      }
    }

    if (!driveOk) {
      mostrarErro(
        `Turmas salvas e login pronto, mas não consegui liberar o acesso ao Drive automaticamente. Você pode compartilhar a pasta da turma manualmente com ${email} direto pelo Google Drive.`
      );
    } else {
      mostrarSucesso(
        loginCriadoAgora
          ? `Tudo pronto! Login criado, turmas liberadas e acesso ao Drive concedido pra ${email}. Ela já recebeu o e-mail pra criar a senha.`
          : `Turmas e acesso ao Drive de ${email} atualizados com sucesso!`
      );
    }
    sairModoEdicao();
  } catch (erro) {
    console.error(erro);
    if (erro.code === "permission-denied") {
      mostrarErro("Sem permissão para salvar. Verifique as regras do Firestore.");
    } else if (erro.message) {
      mostrarErro(erro.message);
    } else {
      mostrarErro("Não foi possível salvar. Tente novamente.");
    }
  } finally {
    submitButton.disabled = false;
    submitButtonText.textContent = emailEmEdicao ? "Salvar alterações" : "Salvar";
  }
});

// ---------- Lista de professoras em tempo real ----------
function carregarProfessores() {
  const ref = collection(db, "professores");
  const consulta = query(ref, orderBy("criadoEm", "desc"));

  onSnapshot(consulta, (snapshot) => {
    professoresCache.clear();

    if (snapshot.empty) {
      professoresList.innerHTML = `<p class="empty-state">Nenhuma professora com turma liberada ainda.</p>`;
      professoresCount.textContent = "0 professoras";
      return;
    }

    professoresCount.textContent = `${snapshot.size} professora${snapshot.size > 1 ? "s" : ""}`;
    professoresList.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const dados = docSnap.data();
      professoresCache.set(docSnap.id, dados);

      const item = document.createElement("div");
      item.className = "professor-item";
      item.innerHTML = `
        <div>
          <p class="professor-email">${docSnap.id}</p>
          <p class="professor-turmas">${(dados.turmas || []).join(", ") || "Nenhuma turma"}</p>
        </div>
        <div class="professor-actions">
          <button class="btn-ghost professor-enviar-acesso" data-email="${docSnap.id}">Enviar e-mail de acesso</button>
          <button class="btn-ghost professor-edit" data-email="${docSnap.id}">Editar</button>
          <button class="btn-ghost professor-remover" data-email="${docSnap.id}">Remover</button>
        </div>
      `;
      professoresList.appendChild(item);
    });

    document.querySelectorAll(".professor-enviar-acesso").forEach((botao) => {
      botao.addEventListener("click", async () => {
        const email = botao.getAttribute("data-email");
        const textoOriginal = botao.textContent;
        botao.disabled = true;
        botao.textContent = "Enviando...";

        try {
          await sendPasswordResetEmail(auth, email);
          botao.textContent = "E-mail enviado ✓";
          setTimeout(() => {
            botao.textContent = textoOriginal;
            botao.disabled = false;
          }, 3000);
        } catch (erro) {
          console.error(erro);
          alert(
            erro.code === "auth/user-not-found"
              ? "Esse e-mail ainda não tem login criado no Firebase Authentication. Crie o login dela lá primeiro."
              : "Não foi possível enviar o e-mail. Tente novamente."
          );
          botao.disabled = false;
          botao.textContent = textoOriginal;
        }
      });
    });

    document.querySelectorAll(".professor-edit").forEach((botao) => {
      botao.addEventListener("click", () => entrarModoEdicao(botao.getAttribute("data-email")));
    });

    document.querySelectorAll(".professor-remover").forEach((botao) => {
      botao.addEventListener("click", async () => {
        const email = botao.getAttribute("data-email");
        if (!confirm(`Remover o acesso de ${email}? Ela deixa de ver qualquer turma até ser liberada de novo.`)) return;
        if (emailEmEdicao === email) sairModoEdicao();
        await deleteDoc(doc(db, "professores", email));
      });
    });
  }, (erro) => {
    console.error(erro);
    professoresList.innerHTML = `<p class="empty-state">Não foi possível carregar. Verifique as regras do Firestore.</p>`;
  });
}

// ---------- Aprendizado retroativo ----------
// Passa pelas fotos já confirmadas (pendente: false) e, só nos casos
// SEM ambiguidade (fotos onde apenas 1 pessoa foi confirmada na mesma
// imagem, usando o grupoFotoId pra saber disso), guarda como referência
// extra do aluno. Fotos antigas sem grupoFotoId são puladas, por
// segurança (não dá pra saber se eram de grupo ou não).
const aprendizadoBotao = document.getElementById("aprendizado-retroativo-button");
const aprendizadoStatus = document.getElementById("aprendizado-retroativo-status");

aprendizadoBotao.addEventListener("click", async () => {
  aprendizadoBotao.disabled = true;
  aprendizadoStatus.textContent = "Buscando fotos já confirmadas...";

  try {
    const snapshot = await getDocs(query(collection(db, "fotos"), where("pendente", "==", false)));

    const porGrupo = new Map(); // grupoFotoId -> [{alunoId, foto}]
    snapshot.forEach((docSnap) => {
      const dados = docSnap.data();
      if (!dados.grupoFotoId || !dados.alunoId || !dados.foto) return; // pula fotos antigas sem esse controle
      if (!porGrupo.has(dados.grupoFotoId)) porGrupo.set(dados.grupoFotoId, []);
      porGrupo.get(dados.grupoFotoId).push({ alunoId: dados.alunoId, foto: dados.foto });
    });

    // Só os grupos com exatamente 1 pessoa confirmada (sem ambiguidade)
    const semAmbiguidade = [...porGrupo.values()].filter((grupo) => grupo.length === 1).map((grupo) => grupo[0]);

    aprendizadoStatus.textContent = `Encontradas ${semAmbiguidade.length} foto(s) sem ambiguidade de ${porGrupo.size} imagem(ns) confirmada(s). Aprendendo...`;

    let processadas = 0;
    for (const { alunoId, foto } of semAmbiguidade) {
      await aprenderComFoto(alunoId, foto);
      processadas++;
      aprendizadoStatus.textContent = `Aprendendo... (${processadas}/${semAmbiguidade.length})`;
    }

    aprendizadoStatus.textContent = `✅ Concluído! ${processadas} foto(s) usada(s) como referência extra (de ${porGrupo.size} imagem(ns) confirmada(s) no total - o restante tinha mais de 1 pessoa na mesma foto, então foi pulado por segurança).`;
  } catch (erro) {
    console.error(erro);
    aprendizadoStatus.textContent = `Erro: ${erro.message || erro}`;
  } finally {
    aprendizadoBotao.disabled = false;
  }
});

// ---------- Limpar turma de teste ----------
// Apaga TUDO de uma turma: alunos, fotos de referência, fotos enviadas
// (Firestore) e a pasta inteira dela no Google Drive. Não dá pra
// desfazer - usado só pra limpar dados de teste antes de começar a
// usar de verdade com uma turma.
function preencherSelectLimparTurma() {
  const select = document.getElementById("limpar-turma-select");
  const segmentos = [...new Set(TURMAS.map((t) => t.segmento))];
  segmentos.forEach((segmento) => {
    const grupo = document.createElement("optgroup");
    grupo.label = NOMES_SEGMENTO[segmento] || segmento;
    TURMAS.filter((t) => t.segmento === segmento).forEach((turma) => {
      const option = document.createElement("option");
      option.value = turma.nome;
      option.textContent = turma.nome;
      grupo.appendChild(option);
    });
    select.appendChild(grupo);
  });
}

const limparTurmaSelect = document.getElementById("limpar-turma-select");
const limparTurmaBotao = document.getElementById("limpar-turma-button");
const limparTurmaStatus = document.getElementById("limpar-turma-status");

limparTurmaBotao.addEventListener("click", async () => {
  const turma = limparTurmaSelect.value;
  if (!turma) {
    alert("Selecione uma turma primeiro.");
    return;
  }

  const confirmacao = prompt(
    `Isso vai APAGAR PRA SEMPRE todos os alunos, fotos e a pasta do Drive da turma "${turma}".\n\nPra confirmar, digite o nome da turma exatamente: ${turma}`
  );
  if (confirmacao !== turma) {
    alert("Cancelado (o texto digitado não bateu com o nome da turma).");
    return;
  }

  limparTurmaBotao.disabled = true;

  try {
    // 1. Apaga a pasta inteira da turma no Drive (leva junto tudo que
    // tem dentro - alunos, atividades, fotos)
    limparTurmaStatus.textContent = "Conectando ao Drive...";
    const accessToken = await garantirTokenAcesso();
    const pastaTurmaId = await obterOuCriarPasta(turma, obterPastaRaizDaTurma(turma), accessToken);
    limparTurmaStatus.textContent = "Apagando pasta no Drive...";
    await excluirPasta(pastaTurmaId, accessToken);

    // 2. Apaga os documentos de "fotos" dessa turma no Firestore
    limparTurmaStatus.textContent = "Apagando fotos no banco de dados...";
    const fotosSnap = await getDocs(query(collection(db, "fotos"), where("turma", "==", turma)));
    let apagadas = 0;
    for (const docSnap of fotosSnap.docs) {
      await deleteDoc(docSnap.ref);
      apagadas++;
      limparTurmaStatus.textContent = `Apagando fotos no banco de dados... (${apagadas}/${fotosSnap.size})`;
    }

    // 3. Apaga os alunos dessa turma (documento principal + referência)
    limparTurmaStatus.textContent = "Apagando alunos...";
    const alunosSnap = await getDocs(query(collection(db, "alunos"), where("turma", "==", turma)));
    let alunosApagados = 0;
    for (const docSnap of alunosSnap.docs) {
      await deleteDoc(docSnap.ref);
      await deleteDoc(doc(db, "alunos_referencia", docSnap.id)).catch(() => {});
      alunosApagados++;
    }

    limparTurmaStatus.textContent = `✅ Turma "${turma}" limpa! ${alunosApagados} aluno(s) e ${apagadas} foto(s) removidos, pasta do Drive apagada.`;
    limparTurmaSelect.value = "";
  } catch (erro) {
    console.error(erro);
    limparTurmaStatus.textContent = `Erro: ${erro.message || erro}`;
  } finally {
    limparTurmaBotao.disabled = false;
  }
});
