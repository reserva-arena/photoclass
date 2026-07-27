// ============================================
// PhotoClass - Aprendizado incremental
// ============================================
// Quando uma professora confirma manualmente (e sem ambiguidade) que
// uma foto é de um aluno, guardamos essa foto como referência extra
// dele - assim o reconhecimento fica mais preciso com o tempo, sem
// precisar cadastrar fotos novas manualmente.
//
// Importante: só "aprende" em casos SEM ambiguidade (uma foto com uma
// pessoa só sendo confirmada) - nunca em fotos de grupo, pra não
// guardar a referência errada por engano. E nunca a partir de
// reconhecimentos automáticos aceitos sem revisão - só de ações que
// exigiram escolha manual da professora.

import { db } from "./firebase-config.js?v=20260727i";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const MAX_FOTOS_APRENDIDAS = 5; // limite por aluno, pra não pesar o documento nem deixar o reconhecimento lento demais

export async function aprenderComFoto(alunoId, fotoDataUrl) {
  if (!alunoId || !fotoDataUrl) return;

  try {
    const alunoRef = doc(db, "alunos", alunoId);
    const snap = await getDoc(alunoRef);
    if (!snap.exists()) return;

    const atuais = snap.data().fotosAprendidas || [];
    const novaLista = [...atuais, fotoDataUrl].slice(-MAX_FOTOS_APRENDIDAS);

    await updateDoc(alunoRef, { fotosAprendidas: novaLista });
  } catch (erro) {
    // Não deixa isso quebrar o fluxo principal (salvar a foto é o que importa)
    console.error("Erro ao aprender com a foto:", erro);
  }
}
