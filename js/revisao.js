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
import { configurarAlternadorVisao } from "./roles.js";

const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");
const turmaFiltro = document.getElementById("turma-filtro");
const revisaoSubtitle = document.getElementById("revisao-subtitle");
const revisaoList = document.getElementById("revisao-list");

let alunosPorTurma = {}; // { "9B": [{id, nome}, ...] }
let pararDeEscutar = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    carregarTurmasEAlunos().then(() => escutarPendentes());
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Carrega turmas e alunos (para preencher os selects de correção) ----------
async function carregarTurmasEAlunos() {
  const alunosRef = collection(db, "alunos");
  const snapshot = await getDocs(query(alunosRef, where("segmento", "==", "anosIniciais")));

  alunosPorTurma = {};
  snapshot.forEach((docSnap) => {
    const aluno = docSnap.data();
    if (!alunosPorTurma[aluno.turma]) alunosPorTurma[aluno.turma] = [];
    alunosPorTurma[aluno.turma].push({ id: docSnap.id, nome: aluno.nome });
  });

  turmaFiltro.innerHTML = `<option value="">Todas as turmas</option>`;
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

  const fotosRef = collection(db, "fotos");
  const turmaSelecionada = turmaFiltro.value;

  const consulta = turmaSelecionada
    ? query(fotosRef, where("pendente", "==", true), where("turma", "==", turmaSelecionada))
    : query(fotosRef, where("pendente", "==", true));

  pararDeEscutar = onSnapshot(consulta, (snapshot) => {
    renderizarLista(snapshot);
  }, (erro) => {
    console.error(erro);
    revisaoList.innerHTML = `<p class="empty-state">Não foi possível carregar. Verifique as regras do Firestore.</p>`;
  });
}

function renderizarLista(snapshot) {
  if (snapshot.empty) {
    revisaoSubtitle.textContent = "Nenhuma foto pendente 🎉";
    revisaoList.innerHTML = `<p class="empty-state">Tudo revisado por aqui!</p>`;
    return;
  }

  revisaoSubtitle.textContent = `${snapshot.size} foto(s) aguardando identificação`;
  revisaoList.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const alunosDaTurma = alunosPorTurma[item.turma] || [];
    const opcoesAlunos = alunosDaTurma.map((a) => `<option value="${a.id}">${a.nome}</option>`).join("");

    const card = document.createElement("div");
    card.className = "result-item";
    card.innerHTML = `
      <img src="${item.foto}" alt="Foto pendente" class="result-photo">
      <div class="result-faces">
        <span class="face-confidence">Turma: ${item.turma}</span>
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
      await updateDoc(doc(db, "fotos", id), {
        alunoId,
        alunoNome,
        pendente: false
      });
    });
  });

  document.querySelectorAll(".descartar-btn").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const id = botao.getAttribute("data-id");
      if (confirm("Descartar esta foto? Essa ação não pode ser desfeita.")) {
        await deleteDoc(doc(db, "fotos", id));
      }
    });
  });
}
