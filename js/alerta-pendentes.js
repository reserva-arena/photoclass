// ============================================
// PhotoClass - Alerta de fotos pendentes
// ============================================
// Mostra uma faixa de aviso no topo da página (qualquer uma, exceto
// a própria Revisão) quando existem fotos aguardando identificação.

import { db } from "./firebase-config.js?v=20260727l";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export async function mostrarAlertaPendentes(turmasPermitidas) {
  // Já está na tela de Revisão, ou não tem nenhuma turma liberada: não mostra nada
  if (window.location.pathname.endsWith("revisao.html")) return;
  if (turmasPermitidas !== null && turmasPermitidas.length === 0) return;

  try {
    const fotosRef = collection(db, "fotos");
    const snapshot = turmasPermitidas === null
      ? await getDocs(query(fotosRef, where("pendente", "==", true)))
      : await getDocs(query(fotosRef, where("turma", "in", turmasPermitidas)));

    let pendentes = 0;
    snapshot.forEach((docSnap) => {
      if (docSnap.data().pendente) pendentes++;
    });

    if (pendentes === 0) return;

    const banner = document.createElement("a");
    banner.href = "revisao.html";
    banner.className = "alerta-pendentes-banner";
    banner.innerHTML = `⚠️ <strong>${pendentes} foto${pendentes > 1 ? "s" : ""}</strong> aguardando identificação — clique para resolver na Revisão`;
    document.body.prepend(banner);
  } catch (erro) {
    console.error(erro);
  }
}
