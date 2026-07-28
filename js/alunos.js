// ============================================
// PhotoClass - Cadastro de Alunos
// ============================================
// Até 3 fotos de referência por aluno (base64 no Firestore), pra
// melhorar a precisão do reconhecimento em ângulos/expressões
// diferentes. Comprimidas no navegador antes de salvar.

import { auth, db } from "./firebase-config.js?v=20260727t";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260727t";
import { mostrarAlertaPendentes } from "./alerta-pendentes.js?v=20260727t";
import { TURMAS, NOMES_SEGMENTO } from "./turmas.js?v=20260727t";

// ---------- Elementos ----------
const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

const formTitle = document.getElementById("form-title");
const form = document.getElementById("student-form");
const nomeInput = document.getElementById("nome");
const turmaInput = document.getElementById("turma");
const cancelEditButton = document.getElementById("cancel-edit-button");
const fotoHint = document.getElementById("foto-hint");

// Preenche o select de turmas, agrupado por segmento - restrito às
// turmas permitidas quando não é admin (turmasPermitidas === null = todas)
function preencherTurmas() {
  const semTurmaAviso = document.getElementById("cadastro-sem-turma");

  // Sem nenhuma turma liberada: esconde o formulário inteiro e mostra um aviso claro
  if (turmasPermitidas !== null && turmasPermitidas.length === 0) {
    form.hidden = true;
    semTurmaAviso.hidden = false;
    return;
  }
  form.hidden = false;
  semTurmaAviso.hidden = true;

  const turmasVisiveis = turmasPermitidas === null
    ? TURMAS
    : TURMAS.filter((t) => turmasPermitidas.includes(t.nome));

  turmaInput.innerHTML = `<option value="">Selecione a turma</option>`;
  const segmentos = [...new Set(turmasVisiveis.map((t) => t.segmento))];
  segmentos.forEach((segmento) => {
    const grupo = document.createElement("optgroup");
    grupo.label = NOMES_SEGMENTO[segmento] || segmento;
    turmasVisiveis.filter((t) => t.segmento === segmento).forEach((turma) => {
      const option = document.createElement("option");
      option.value = turma.nome;
      option.textContent = turma.nome;
      grupo.appendChild(option);
    });
    turmaInput.appendChild(grupo);
  });
}
const fotoInputs = [1, 2, 3].map((n) => document.getElementById(`foto-${n}`));
const photoPreviews = [1, 2, 3].map((n) => document.getElementById(`photo-preview-img-${n}`));
const photoPreviewPlaceholders = [1, 2, 3].map((n) => document.getElementById(`photo-preview-placeholder-${n}`));
const formError = document.getElementById("form-error");
const formSuccess = document.getElementById("form-success");
const submitButton = document.getElementById("submit-button");
const submitButtonText = document.getElementById("submit-button-text");

const studentsList = document.getElementById("students-list");
const studentsCount = document.getElementById("students-count");

let usuarioAtual = null;
let turmasPermitidas = null; // null = admin (todas); [] = nenhuma turma liberada ainda
let alunoEmEdicaoId = null; // null = modo cadastro; senão, id do aluno sendo editado
let fotosEmEdicao = [null, null, null]; // fotos atuais do aluno em edição, uma por slot
const alunosCache = new Map(); // id -> dados do aluno, pra reaproveitar ao entrar em edição

// ---------- Proteção da página ----------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    usuarioAtual = user;
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    configurarMenuMobile();
    configurarNavProfessores(user.email);
    obterTurmasPermitidas(user.email).then((turmas) => {
      turmasPermitidas = turmas;
      preencherTurmas();
      carregarAlunos();
      mostrarAlertaPendentes(turmas);
    });
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Pré-visualização das fotos (3 slots) ----------
fotoInputs.forEach((input, indice) => {
  input.addEventListener("change", () => {
    const arquivo = input.files[0];
    if (!arquivo) return;

    const leitor = new FileReader();
    leitor.onload = (e) => {
      photoPreviews[indice].src = e.target.result;
      photoPreviews[indice].hidden = false;
      photoPreviewPlaceholders[indice].hidden = true;
    };
    leitor.readAsDataURL(arquivo);
  });
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
  // Compatível com cadastros antigos (campo único "foto") e novos ("fotos": [...])
  const fotosAtuais = aluno.fotos && aluno.fotos.length > 0 ? aluno.fotos : (aluno.foto ? [aluno.foto] : []);
  fotosEmEdicao = [fotosAtuais[0] || null, fotosAtuais[1] || null, fotosAtuais[2] || null];

  nomeInput.value = aluno.nome;
  turmaInput.value = aluno.turma;

  fotoInputs.forEach((input, indice) => {
    input.value = "";
    if (fotosEmEdicao[indice]) {
      photoPreviews[indice].src = fotosEmEdicao[indice];
      photoPreviews[indice].hidden = false;
      photoPreviewPlaceholders[indice].hidden = true;
    } else {
      photoPreviews[indice].hidden = true;
      photoPreviewPlaceholders[indice].hidden = false;
    }
  });

  formTitle.textContent = `Editando: ${aluno.nome}`;
  submitButtonText.textContent = "Salvar alterações";
  cancelEditButton.hidden = false;
  fotoHint.hidden = false;
  esconderMensagens();

  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function sairModoEdicao() {
  alunoEmEdicaoId = null;
  fotosEmEdicao = [null, null, null];

  form.reset();
  fotoInputs.forEach((input, indice) => {
    photoPreviews[indice].hidden = true;
    photoPreviewPlaceholders[indice].hidden = false;
  });

  formTitle.textContent = "Cadastrar aluno";
  submitButtonText.textContent = "Cadastrar aluno";
  cancelEditButton.hidden = true;
  fotoHint.hidden = true;
  esconderMensagens();
}

cancelEditButton.addEventListener("click", sairModoEdicao);

// Converte o arquivo de imagem para base64, já reduzindo o tamanho
// (importante agora que podem ser até 3 fotos por aluno no mesmo documento)
function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 640;
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject;
      img.src = leitor.result;
    };
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
  const editando = Boolean(alunoEmEdicaoId);

  const arquivosSelecionados = fotoInputs.map((input) => input.files[0] || null);
  const primeiroSlotPreenchido = arquivosSelecionados[0] || (editando && fotosEmEdicao[0]);

  if (!nome || !turma || !primeiroSlotPreenchido) {
    mostrarErro("Preencha nome, turma e ao menos a primeira foto de referência.");
    return;
  }

  if (turmasPermitidas !== null && !turmasPermitidas.includes(turma)) {
    mostrarErro("Você não tem permissão para essa turma.");
    return;
  }

  for (const arquivo of arquivosSelecionados) {
    if (arquivo && arquivo.size > 5 * 1024 * 1024) {
      mostrarErro("Uma das fotos está muito grande (máx. 5MB antes da compressão).");
      return;
    }
  }

  definirCarregando(true);

  try {
    // Cada slot: se escolheu arquivo novo, comprime e usa; senão (em
    // edição) mantém a foto que já estava salva ali
    const fotos = [];
    for (let i = 0; i < 3; i++) {
      if (arquivosSelecionados[i]) {
        fotos.push(await arquivoParaBase64(arquivosSelecionados[i]));
      } else if (editando && fotosEmEdicao[i]) {
        fotos.push(fotosEmEdicao[i]);
      }
    }

    const dados = {
      nome,
      turma,
      fotos,
      foto: fotos[0], // mantido por compatibilidade com telas antigas
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
      sairModoEdicao();
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
  // Professora sem nenhuma turma liberada ainda: nem consulta o Firestore
  if (turmasPermitidas !== null && turmasPermitidas.length === 0) {
    studentsList.innerHTML = `<p class="empty-state">Você ainda não tem nenhuma turma liberada. Fale com o administrador do PhotoClass.</p>`;
    studentsCount.textContent = "Nenhuma turma liberada";
    return;
  }

  const alunosRef = collection(db, "alunos");
  const consulta = turmasPermitidas === null
    ? query(alunosRef, orderBy("criadoEm", "desc"))
    : query(alunosRef, where("turma", "in", turmasPermitidas));

  onSnapshot(consulta, (snapshot) => {
    if (snapshot.empty) {
      studentsList.innerHTML = `<p class="empty-state">Nenhum aluno cadastrado ainda.</p>`;
      studentsCount.textContent = "0 alunos cadastrados";
      return;
    }

    let docsOrdenados = [...snapshot.docs];
    if (turmasPermitidas !== null) {
      docsOrdenados.sort((a, b) => (b.data().criadoEm?.toMillis() || 0) - (a.data().criadoEm?.toMillis() || 0));
    }

    studentsCount.textContent = `${snapshot.size} aluno${snapshot.size > 1 ? "s" : ""} cadastrado${snapshot.size > 1 ? "s" : ""}`;

    studentsList.innerHTML = "";
    alunosCache.clear();
    docsOrdenados.forEach((docSnap) => {
      const aluno = docSnap.data();
      alunosCache.set(docSnap.id, aluno);

      const card = document.createElement("div");
      card.className = "student-card";
      const fotoCapa = (aluno.fotos && aluno.fotos[0]) || aluno.foto;
      const totalFotos = aluno.fotos ? aluno.fotos.length : (aluno.foto ? 1 : 0);
      card.innerHTML = `
        <button class="student-edit" title="Editar aluno" data-id="${docSnap.id}">✎</button>
        <img src="${fotoCapa}" alt="Foto de ${aluno.nome}" class="student-photo">
        <div class="student-info">
          <p class="student-name">${aluno.nome}</p>
          <p class="student-class">${aluno.turma}${totalFotos > 1 ? ` · ${totalFotos} fotos` : ""}</p>
        </div>
        <button class="student-delete" title="Remover aluno" data-id="${docSnap.id}">×</button>
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
