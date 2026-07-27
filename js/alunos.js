// ============================================
// PhotoClass - Cadastro de Alunos
// ============================================
// Por enquanto a foto é salva como base64 direto no Firestore
// (funciona bem para uma foto de referência por aluno).
// Quando construirmos o upload de fotos do dia a dia, essas
// sim vão para o Google Drive - a foto de referência pode
// continuar aqui, já que é só uma por aluno.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, estaEmModoAdmin } from "./roles.js";
import { TURMAS, NOMES_SEGMENTO } from "./turmas.js";

// ---------- Elementos ----------
const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

const formTitle = document.getElementById("form-title");
const form = document.getElementById("student-form");
const nomeInput = document.getElementById("nome");
const turmaInput = document.getElementById("turma");
const cancelEditButton = document.getElementById("cancel-edit-button");
const fotoHint = document.getElementById("foto-hint");

// Preenche o select de turmas, agrupado por segmento
function preencherTurmas() {
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
    turmaInput.appendChild(grupo);
  });
}
preencherTurmas();
const fotoInput = document.getElementById("foto");
const photoPreview = document.getElementById("photo-preview-img");
const photoPreviewPlaceholder = document.getElementById("photo-preview-placeholder");
const formError = document.getElementById("form-error");
const formSuccess = document.getElementById("form-success");
const submitButton = document.getElementById("submit-button");
const submitButtonText = document.getElementById("submit-button-text");

const studentsList = document.getElementById("students-list");
const studentsCount = document.getElementById("students-count");

let usuarioAtual = null;
let alunoEmEdicaoId = null; // null = modo cadastro; senão, id do aluno sendo editado
let fotoBase64EmEdicao = null; // guarda a foto atual do aluno, caso não troque por uma nova
const alunosCache = new Map(); // id -> dados do aluno, pra reaproveitar ao entrar em edição

// ---------- Proteção da página ----------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    usuarioAtual = user;
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    carregarAlunos();
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Pré-visualização da foto ----------
fotoInput.addEventListener("change", () => {
  const arquivo = fotoInput.files[0];
  if (!arquivo) return;

  const leitor = new FileReader();
  leitor.onload = (e) => {
    photoPreview.src = e.target.result;
    photoPreview.hidden = false;
    photoPreviewPlaceholder.hidden = true;
  };
  leitor.readAsDataURL(arquivo);
});

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

function definirCarregando(carregando) {
  submitButton.disabled = carregando;
  submitButtonText.textContent = carregando
    ? (alunoEmEdicaoId ? "Salvando..." : "Cadastrando...")
    : (alunoEmEdicaoId ? "Salvar alterações" : "Cadastrar aluno");
}

// ---------- Modo edição ----------
function entrarModoEdicao(id) {
  const aluno = alunosCache.get(id);
  if (!aluno) return;

  alunoEmEdicaoId = id;
  fotoBase64EmEdicao = aluno.foto;

  nomeInput.value = aluno.nome;
  turmaInput.value = aluno.turma;
  fotoInput.value = "";
  fotoInput.required = false;
  photoPreview.src = aluno.foto;
  photoPreview.hidden = false;
  photoPreviewPlaceholder.hidden = true;

  formTitle.textContent = `Editando: ${aluno.nome}`;
  submitButtonText.textContent = "Salvar alterações";
  cancelEditButton.hidden = false;
  fotoHint.hidden = false;
  esconderMensagens();

  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function sairModoEdicao() {
  alunoEmEdicaoId = null;
  fotoBase64EmEdicao = null;

  form.reset();
  fotoInput.required = true;
  photoPreview.hidden = true;
  photoPreviewPlaceholder.hidden = false;

  formTitle.textContent = "Cadastrar aluno";
  submitButtonText.textContent = "Cadastrar aluno";
  cancelEditButton.hidden = true;
  fotoHint.hidden = true;
  esconderMensagens();
}

cancelEditButton.addEventListener("click", sairModoEdicao);

// Converte o arquivo de imagem para base64 (texto), pra salvar no Firestore
function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

// ---------- Cadastro / Edição de aluno ----------
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  esconderMensagens();

  const nome = nomeInput.value.trim();
  const turma = turmaInput.value.trim();
  const arquivo = fotoInput.files[0];
  const editando = Boolean(alunoEmEdicaoId);

  if (!nome || !turma || (!editando && !arquivo)) {
    mostrarErro("Preencha nome, turma e selecione uma foto.");
    return;
  }

  // Limite de tamanho pra não estourar o documento do Firestore (máx. 1MB por documento)
  if (arquivo && arquivo.size > 700 * 1024) {
    mostrarErro("A foto está muito grande. Escolha uma imagem menor (até 700KB).");
    return;
  }

  definirCarregando(true);

  try {
    // Se trocou a foto, usa a nova; senão (só em edição), mantém a atual
    const fotoBase64 = arquivo ? await arquivoParaBase64(arquivo) : fotoBase64EmEdicao;

    const dados = {
      nome,
      turma,
      foto: fotoBase64,
      segmento: TURMAS.find((t) => t.nome === turma)?.segmento || "desconhecido"
    };

    if (editando) {
      await updateDoc(doc(db, "alunos", alunoEmEdicaoId), dados);
      mostrarSucesso(`${nome} atualizado(a) com sucesso!`);
      sairModoEdicao();
    } else {
      await addDoc(collection(db, "alunos"), {
        ...dados,
        criadoPor: usuarioAtual.uid,
        criadoEm: serverTimestamp()
      });
      mostrarSucesso(`${nome} cadastrado(a) com sucesso!`);
      form.reset();
      photoPreview.hidden = true;
      photoPreviewPlaceholder.hidden = false;
    }
  } catch (erro) {
    console.error(erro);
    if (erro.code === "permission-denied") {
      mostrarErro("Sem permissão para salvar. Verifique as regras do Firestore.");
    } else {
      mostrarErro("Não foi possível salvar. Tente novamente.");
    }
  } finally {
    definirCarregando(false);
  }
});

// ---------- Lista de alunos em tempo real ----------
function carregarAlunos() {
  const alunosRef = collection(db, "alunos");
  const consulta = query(alunosRef, orderBy("criadoEm", "desc"));

  onSnapshot(consulta, (snapshot) => {
    if (snapshot.empty) {
      studentsList.innerHTML = `<p class="empty-state">Nenhum aluno cadastrado ainda.</p>`;
      studentsCount.textContent = "0 alunos cadastrados";
      return;
    }

    studentsCount.textContent = `${snapshot.size} aluno${snapshot.size > 1 ? "s" : ""} cadastrado${snapshot.size > 1 ? "s" : ""}`;

    studentsList.innerHTML = "";
    alunosCache.clear();
    snapshot.forEach((docSnap) => {
      const aluno = docSnap.data();
      alunosCache.set(docSnap.id, aluno);

      const card = document.createElement("div");
      card.className = "student-card";
      const podeExcluir = estaEmModoAdmin(usuarioAtual.email);
      card.innerHTML = `
        <button class="student-edit" title="Editar aluno" data-id="${docSnap.id}">✎</button>
        <img src="${aluno.foto}" alt="Foto de ${aluno.nome}" class="student-photo">
        <div class="student-info">
          <p class="student-name">${aluno.nome}</p>
          <p class="student-class">${aluno.turma}</p>
        </div>
        ${podeExcluir ? `<button class="student-delete" title="Remover aluno" data-id="${docSnap.id}">×</button>` : ""}
      `;
      studentsList.appendChild(card);
    });

    // Liga os botões de editar
    document.querySelectorAll(".student-edit").forEach((botao) => {
      botao.addEventListener("click", () => {
        entrarModoEdicao(botao.getAttribute("data-id"));
      });
    });

    // Liga os botões de exclusão
    document.querySelectorAll(".student-delete").forEach((botao) => {
      botao.addEventListener("click", async () => {
        const id = botao.getAttribute("data-id");
        if (confirm("Remover este aluno?")) {
          if (alunoEmEdicaoId === id) sairModoEdicao();
          await deleteDoc(doc(db, "alunos", id));
        }
      });
    });
  }, (erro) => {
    console.error(erro);
    studentsList.innerHTML = `<p class="empty-state">Não foi possível carregar os alunos. Verifique as regras do Firestore.</p>`;
  });
}
