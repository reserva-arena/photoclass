// ============================================
// PhotoClass - Cadastro de Alunos
// ============================================
// Até 3 fotos de referência por aluno + fotos "aprendidas" com o uso.
// Pra manter as telas de listagem (Alunos, Galeria) sempre rápidas no
// celular, essas fotos pesadas NÃO ficam no documento principal do
// aluno - elas vivem separadas, em "alunos_referencia/{id}", e só são
// buscadas quando realmente precisa (editar aluno, ou reconhecer
// rostos). O documento principal "alunos/{id}" guarda só o essencial
// + uma capa pequena, pra listar rápido sempre.

import { auth, db } from "./firebase-config.js?v=20260804a";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260804a";
import { mostrarAlertaPendentes } from "./alerta-pendentes.js?v=20260804a";
import { TURMAS, NOMES_SEGMENTO } from "./turmas.js?v=20260804a";

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
const emailsResponsaveisInput = document.getElementById("emails-responsaveis");
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
let carregamentoConcluido = false;

// Se em 10s ainda não carregou nem deu erro (rede muito lenta/travada),
// avisa em vez de deixar "Carregando..." pra sempre
setTimeout(() => {
  if (!carregamentoConcluido) {
    studentsCount.textContent = "Demorando mais que o esperado...";
    studentsList.innerHTML = `<p class="empty-state">Isso está demorando demais - verifique sua conexão e tente atualizar a página.</p>`;
  }
}, 10000);

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    usuarioAtual = user;
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    configurarMenuMobile();
    configurarNavProfessores(user.email);
    obterTurmasPermitidas(user.email)
      .then((turmas) => {
        turmasPermitidas = turmas;
        preencherTurmas();
        carregarAlunos();
        mostrarAlertaPendentes(turmas);
        carregamentoConcluido = true;
      })
      .catch((erro) => {
        carregamentoConcluido = true;
        console.error(erro);
        studentsCount.textContent = "Não foi possível carregar.";
        studentsList.innerHTML = `<p class="empty-state">Erro ao carregar: ${erro.message || erro}. Tente atualizar a página.</p>`;
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
async function entrarModoEdicao(id) {
  const aluno = alunosCache.get(id);
  if (!aluno) return;

  alunoEmEdicaoId = id;
  nomeInput.value = aluno.nome;
  turmaInput.value = aluno.turma;
  emailsResponsaveisInput.value = (aluno.emailsResponsaveis || []).join(", ");

  formTitle.textContent = `Editando: ${aluno.nome}`;
  submitButtonText.textContent = "Salvar alterações";
  cancelEditButton.hidden = false;
  fotoHint.hidden = false;
  esconderMensagens();
  fotoInputs.forEach((input) => { input.value = ""; });

  // Fotos de referência ficam separadas (documento mais pesado) -
  // busca só agora, na hora de editar
  photoPreviewPlaceholders.forEach((p) => { p.textContent = "Carregando..."; });
  const refSnap = await getDoc(doc(db, "alunos_referencia", id));
  const fotosAtuais = refSnap.exists() && refSnap.data().fotos && refSnap.data().fotos.length > 0
    ? refSnap.data().fotos
    : (aluno.fotos && aluno.fotos.length > 0 ? aluno.fotos : (aluno.foto ? [aluno.foto] : [])); // compatível com cadastros bem antigos ainda não migrados
  fotosEmEdicao = [fotosAtuais[0] || null, fotosAtuais[1] || null, fotosAtuais[2] || null];

  fotoInputs.forEach((input, indice) => {
    if (fotosEmEdicao[indice]) {
      photoPreviews[indice].src = fotosEmEdicao[indice];
      photoPreviews[indice].hidden = false;
      photoPreviewPlaceholders[indice].hidden = true;
    } else {
      photoPreviewPlaceholders[indice].textContent = `Foto ${indice + 1}`;
      photoPreviews[indice].hidden = true;
      photoPreviewPlaceholders[indice].hidden = false;
    }
  });

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

// Gera uma versão bem pequena de uma foto já existente (data URL), só
// pra usar como capa nas listagens - rápida de carregar sempre
function comprimirCapa(dataUrl, maxDim = 100, qualidade = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
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
      resolve(canvas.toDataURL("image/jpeg", qualidade));
    };
    img.onerror = reject;
    img.src = dataUrl;
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

    const emailsResponsaveis = emailsResponsaveisInput.value
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const capa = await comprimirCapa(fotos[0]);

    // Documento leve (é o que a listagem de Alunos e a Galeria buscam
    // toda hora - precisa ficar sempre pequeno e rápido)
    const dadosLeves = {
      nome,
      turma,
      emailsResponsaveis,
      capa,
      totalFotos: fotos.length,
      segmento: TURMAS.find((t) => t.nome === turma)?.segmento || "desconhecido"
    };

    if (editando) {
      await updateDoc(doc(db, "alunos", alunoEmEdicaoId), dadosLeves);
      await setDoc(doc(db, "alunos_referencia", alunoEmEdicaoId), { fotos }, { merge: true });
      mostrarSucesso(`${nome} atualizado(a) com sucesso!`);
      sairModoEdicao();
    } else {
      const novoDoc = await addDoc(collection(db, "alunos"), {
        ...dadosLeves,
        criadoPor: usuarioAtual.uid,
        criadoEm: serverTimestamp()
      });
      await setDoc(doc(db, "alunos_referencia", novoDoc.id), { fotos });
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
      // Compatível com cadastros antigos (que ainda não foram salvos
      // de novo desde essa mudança, e por isso não têm "capa" ainda)
      const fotoCapa = aluno.capa || (aluno.fotos && aluno.fotos[0]) || aluno.foto;
      const totalFotos = aluno.totalFotos ?? (aluno.fotos ? aluno.fotos.length : (aluno.foto ? 1 : 0));
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
          await deleteDoc(doc(db, "alunos_referencia", id)).catch(() => {}); // ignora se já não existir
        }
      });
    });
  }, (erro) => {
    console.error(erro);
    studentsList.innerHTML = `<p class="empty-state">Não foi possível carregar os alunos. Verifique as regras do Firestore.</p>`;
  });
}
