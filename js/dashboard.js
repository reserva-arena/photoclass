// ============================================
// PhotoClass - Painel Principal
// ============================================
// Resumo rápido: quantos alunos, turmas ativas e fotos pendentes
// de revisão - tudo já filtrado pelas turmas permitidas quando
// não é a conta admin.

import { auth, db } from "./firebase-config.js?v=20260727i";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260727i";
import { mostrarAlertaPendentes } from "./alerta-pendentes.js?v=20260727i";

const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");
const welcomeTitle = document.getElementById("welcome-title");
const welcomeSubtitle = document.getElementById("welcome-subtitle");
const statsGrid = document.getElementById("stats-grid");
const statsEmpty = document.getElementById("stats-empty");
const statAlunos = document.getElementById("stat-alunos");
const statTurmas = document.getElementById("stat-turmas");
const statTurmasLista = document.getElementById("stat-turmas-lista");
const statPendentes = document.getElementById("stat-pendentes");
const statPendentesCard = document.getElementById("stat-pendentes-card");

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    configurarMenuMobile();
    configurarNavProfessores(user.email);

    const primeiroNome = user.email.split("@")[0].split(".")[0];
    welcomeTitle.textContent = `Bem-vindo(a), ${primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1)}!`;

    obterTurmasPermitidas(user.email).then((turmas) => {
      carregarResumo(turmas);
      mostrarAlertaPendentes(turmas);
    });
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

async function carregarResumo(turmasPermitidas) {
  if (turmasPermitidas !== null && turmasPermitidas.length === 0) {
    welcomeSubtitle.textContent = "Nenhuma turma liberada ainda";
    statsEmpty.hidden = false;
    return;
  }

  try {
    const alunosRef = collection(db, "alunos");
    const fotosRef = collection(db, "fotos");

    const alunosSnap = turmasPermitidas === null
      ? await getDocs(query(alunosRef))
      : await getDocs(query(alunosRef, where("turma", "in", turmasPermitidas)));

    const turmasAtivas = new Set();
    alunosSnap.forEach((docSnap) => turmasAtivas.add(docSnap.data().turma));

    const fotosSnap = turmasPermitidas === null
      ? await getDocs(query(fotosRef, where("pendente", "==", true)))
      : await getDocs(query(fotosRef, where("turma", "in", turmasPermitidas)));

    let pendentes = 0;
    fotosSnap.forEach((docSnap) => {
      if (docSnap.data().pendente) pendentes++;
    });

    statAlunos.textContent = alunosSnap.size;
    statTurmas.textContent = turmasAtivas.size;
    statTurmasLista.textContent = turmasAtivas.size > 0 ? [...turmasAtivas].sort().join(", ") : "";
    statPendentes.textContent = pendentes;
    statPendentesCard.classList.toggle("stat-card--alert", pendentes > 0);

    welcomeSubtitle.textContent = turmasPermitidas === null
      ? "Resumo geral do PhotoClass"
      : `Suas turmas: ${turmasPermitidas.join(", ")}`;
    statsGrid.hidden = false;
  } catch (erro) {
    console.error(erro);
    welcomeSubtitle.textContent = "Não foi possível carregar o resumo agora.";
  }
}
