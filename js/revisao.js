// ============================================
// PhotoClass - Revisão de Fotos Pendentes
// ============================================
// Fotos que o reconhecimento facial não conseguiu associar
// a nenhum aluno automaticamente aparecem aqui, pra professora
// resolver manualmente sem precisar subir tudo de novo.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, obterTurmasPermitidas } from "./roles.js";
import { garantirTokenAcesso, obterOuCriarPasta, moverArquivo, excluirArquivo } from "./drive-upload.js";
import { DRIVE_CONFIG } from "./drive-config.js";

const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");
const turmaFiltro = document.getElementById("turma-filtro");
const revisaoSubtitle = document.getElementById("revisao-subtitle");
const revisaoList = document.getElementById("revisao-list");

let alunosPorTurma = {}; // { "9B": [{id, nome}, ...] }
let pararDeEscutar = null;
let itensPendentes = {}; // { docId: {turma, driveFileId, drivePastaId, ...} } - guardado pra poder mexer no Drive ao confirmar/descartar
let turmasPermitidas = null; // null = admin (todas); [] = nenhuma turma liberada ainda

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    configurarNavProfessores(user.email);
    obterTurmasPermitidas(user.email).then((turmas) => {
      turmasPermitidas = turmas;
      carregarTurmasEAlunos().then(() => {
        // Se veio de um link "Ver pendentes na Revisão" (tela de Fotos),
        // já abre filtrado na turma certa
        const turmaDaUrl = new URLSearchParams(window.location.search).get("turma");
        if (turmaDaUrl && [...turmaFiltro.options].some((o) => o.value === turmaDaUrl)) {
          turmaFiltro.value = turmaDaUrl;
        }
        escutarPendentes();
      });
    });
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Carrega turmas e alunos (para preencher os selects de correção) ----------
async function carregarTurmasEAlunos() {
  if (turmasPermitidas !== null && turmasPermitidas.length === 0) {
    alunosPorTurma = {};
    turmaFiltro.innerHTML = `<option value="">Nenhuma turma liberada pra você</option>`;
    return;
  }

  const alunosRef = collection(db, "alunos");
  const snapshot = turmasPermitidas === null
    ? await getDocs(query(alunosRef))
    : await getDocs(query(alunosRef, where("turma", "in", turmasPermitidas)));

  alunosPorTurma = {};
  snapshot.forEach((docSnap) => {
    const aluno = docSnap.data();
    if (!alunosPorTurma[aluno.turma]) alunosPorTurma[aluno.turma] = [];
    alunosPorTurma[aluno.turma].push({ id: docSnap.id, nome: aluno.nome });
  });

  turmaFiltro.innerHTML = `<option value="">${turmasPermitidas === null ? "Todas as turmas" : "Todas as minhas turmas"}</option>`;
  Object.keys(alunosPorTurma).sort().forEach((turma) => {
    const option = document.createElement("option");
    option.value = turma;
    option.textContent = turma;
    turmaFiltro.appendChild(option);
  });
}

turmaFiltro.addEventListener("change", () => escutarPendentes());

// ---------- Escuta em tempo real as fotos pendentes ----------
function escutarPendentes() {
  if (pararDeEscutar) pararDeEscutar();

  if (turmasPermitidas !== null && turmasPermitidas.length === 0) {
    revisaoSubtitle.textContent = "Você ainda não tem nenhuma turma liberada.";
    revisaoList.innerHTML = `<p class="empty-state">Fale com o administrador do PhotoClass.</p>`;
    return;
  }

  const fotosRef = collection(db, "fotos");
  const turmaSelecionada = turmaFiltro.value;

  const consulta = turmaSelecionada
    ? query(fotosRef, where("pendente", "==", true), where("turma", "==", turmaSelecionada))
    : query(fotosRef, where("pendente", "==", true));

  pararDeEscutar = onSnapshot(consulta, (snapshot) => {
    // Quando não filtrou por uma turma específica, ainda restringe às
    // turmas permitidas dela (evita ver pendências de outras turmas)
    const docs = turmaSelecionada || turmasPermitidas === null
      ? snapshot.docs
      : snapshot.docs.filter((docSnap) => turmasPermitidas.includes(docSnap.data().turma));

    renderizarLista(docs);
  }, (erro) => {
    console.error(erro);
    revisaoList.innerHTML = `<p class="empty-state">Não foi possível carregar. Verifique as regras do Firestore.</p>`;
  });
}

function renderizarLista(docs) {
  if (docs.length === 0) {
    revisaoSubtitle.textContent = "Nenhuma foto pendente 🎉";
    revisaoList.innerHTML = `<p class="empty-state">Tudo revisado por aqui!</p>`;
    return;
  }

  revisaoSubtitle.textContent = `${docs.length} foto(s) aguardando identificação`;
  revisaoList.innerHTML = "";
  itensPendentes = {};

  docs.forEach((docSnap) => {
    const item = docSnap.data();
    itensPendentes[docSnap.id] = item;
    const alunosDaTurma = alunosPorTurma[item.turma] || [];
    const opcoesAlunos = alunosDaTurma.map((a) => `<option value="${a.id}">${a.nome}</option>`).join("");

    const card = document.createElement("div");
    card.className = "result-item";
    card.innerHTML = `
      <img src="${item.foto}" alt="Foto pendente" class="result-photo">
      <div class="result-faces">
        <span class="face-confidence">Turma: ${item.turma}${item.atividade ? ` · ${item.atividade}` : ""}</span>
        <div class="result-face">
          <select class="face-select" data-id="${docSnap.id}">
            <option value="">Selecione o aluno...</option>
            ${opcoesAlunos}
          </select>
        </div>
        <div class="result-face">
          <button class="btn-ghost confirmar-btn" data-id="${docSnap.id}">Confirmar</button>
          <button class="btn-ghost descartar-btn" data-id="${docSnap.id}">Descartar</button>
        </div>
      </div>
    `;
    revisaoList.appendChild(card);
  });

  document.querySelectorAll(".confirmar-btn").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const id = botao.getAttribute("data-id");
      const select = document.querySelector(`select[data-id="${id}"]`);
      const alunoId = select.value;
      if (!alunoId) {
        alert("Selecione um aluno antes de confirmar.");
        return;
      }
      const alunoNome = select.options[select.selectedIndex].textContent;
      const textoOriginal = botao.textContent;

      try {
        const item = itensPendentes[id];

        // Se a foto tiver um arquivo real no Drive, move pra pasta do aluno
        if (item && item.driveFileId && item.drivePastaId) {
          botao.disabled = true;
          botao.textContent = "Movendo no Drive...";
          const accessToken = await garantirTokenAcesso();
          const pastaTurma = await obterOuCriarPasta(item.turma, DRIVE_CONFIG.pastaRaizId, accessToken);
          const pastaAluno = await obterOuCriarPasta(alunoNome, pastaTurma, accessToken);
          const pastaDestino = item.atividade
            ? await obterOuCriarPasta(item.atividade, pastaAluno, accessToken)
            : pastaAluno;
          await moverArquivo(item.driveFileId, item.drivePastaId, pastaDestino, accessToken);
        }

        await updateDoc(doc(db, "fotos", id), {
          alunoId,
          alunoNome,
          pendente: false
        });
      } catch (erro) {
        console.error(erro);
        alert(`Erro ao mover a foto no Drive:\n\n${erro.message || erro}`);
        botao.disabled = false;
        botao.textContent = textoOriginal;
      }
    });
  });

  document.querySelectorAll(".descartar-btn").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const id = botao.getAttribute("data-id");
      if (!confirm("Descartar esta foto? Essa ação não pode ser desfeita.")) return;

      try {
        const item = itensPendentes[id];
        if (item && item.driveFileId) {
          const accessToken = await garantirTokenAcesso();
          await excluirArquivo(item.driveFileId, accessToken);
        }
        await deleteDoc(doc(db, "fotos", id));
      } catch (erro) {
        console.error(erro);
        alert(`Erro ao excluir a foto:\n\n${erro.message || erro}`);
      }
    });
  });
}
