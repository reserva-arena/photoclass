// ============================================
// PhotoClass - Revisão de Fotos Pendentes
// ============================================
// Fotos que o reconhecimento facial não conseguiu associar
// a nenhum aluno automaticamente aparecem aqui, pra professora
// resolver manualmente sem precisar subir tudo de novo.

import { auth, db } from "./firebase-config.js?v=20260727f";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  deleteDoc,
  addDoc,
  doc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260727f";
import { garantirTokenAcesso, obterOuCriarPasta, moverArquivo, copiarArquivo, excluirArquivo, definirEmailUsuario } from "./drive-upload.js?v=20260727f";
import { DRIVE_CONFIG } from "./drive-config.js?v=20260727f";

const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");
const turmaFiltro = document.getElementById("turma-filtro");
const revisaoSubtitle = document.getElementById("revisao-subtitle");
const revisaoList = document.getElementById("revisao-list");
const descartarTodasButton = document.getElementById("descartar-todas-button");

let alunosPorTurma = {}; // { "9B": [{id, nome}, ...] }
let pararDeEscutar = null;
let itensPendentes = new Map(); // grupoId -> { item, docs: [{id, driveFileId, drivePastaId, ...}] } - fotos da mesma imagem viram um grupo só
let turmasPermitidas = null; // null = admin (todas); [] = nenhuma turma liberada ainda

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    userEmailLabel.textContent = user.email;
    definirEmailUsuario(user.email);
    configurarAlternadorVisao(user.email);
    configurarMenuMobile();
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

// ---------- Zoom na foto (clique pra ampliar) ----------
revisaoList.addEventListener("click", (evento) => {
  if (!evento.target.classList.contains("js-abrir-foto")) return;
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `<img src="${evento.target.src}" alt="Foto ampliada">`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
});

descartarTodasButton.addEventListener("click", async () => {
  const total = itensPendentes.size;
  if (total === 0) return;
  if (!confirm(`Descartar TODAS as ${total} foto(s) pendente(s) desta lista? Essa ação não pode ser desfeita.`)) return;

  descartarTodasButton.disabled = true;
  const gruposArray = [...itensPendentes.entries()];
  const precisaDrive = gruposArray.some(([, { docs: docsGrupo }]) => docsGrupo.some((d) => d.driveFileId));
  const accessToken = precisaDrive ? await garantirTokenAcesso() : null;

  for (let i = 0; i < gruposArray.length; i++) {
    const [, { docs: docsGrupo }] = gruposArray[i];
    descartarTodasButton.textContent = `Descartando (${i + 1}/${gruposArray.length})...`;
    try {
      for (const docOrigem of docsGrupo) {
        if (docOrigem.driveFileId && accessToken) {
          await excluirArquivo(docOrigem.driveFileId, accessToken);
        }
        await deleteDoc(doc(db, "fotos", docOrigem.id));
      }
    } catch (erro) {
      console.error(erro);
      alert(`Erro ao descartar uma das fotos:\n\n${erro.message || erro}\n\nAs demais continuam sendo processadas.`);
    }
  }

  descartarTodasButton.disabled = false;
});

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

  pararDeEscutar = onSnapshot(consulta, async (snapshot) => {
    // Quando não filtrou por uma turma específica, ainda restringe às
    // turmas permitidas dela (evita ver pendências de outras turmas)
    const docs = turmaSelecionada || turmasPermitidas === null
      ? snapshot.docs
      : snapshot.docs.filter((docSnap) => turmasPermitidas.includes(docSnap.data().turma));

    const jaIdentificados = await buscarJaIdentificadosNasMesmasFotos(docs);
    renderizarLista(docs, jaIdentificados);
  }, (erro) => {
    console.error(erro);
    revisaoList.innerHTML = `<p class="empty-state">Não foi possível carregar. Verifique as regras do Firestore.</p>`;
  });
}

// Busca, pras mesmas fotos que estão pendentes aqui, quem já foi
// identificado (automaticamente ou manualmente) - assim a checklist
// não pergunta de novo por quem já está resolvido
async function buscarJaIdentificadosNasMesmasFotos(docs) {
  const idsGrupo = [...new Set(docs.map((d) => d.data().grupoFotoId).filter(Boolean))];
  const mapa = new Map(); // grupoFotoId -> [{id, nome}]
  if (idsGrupo.length === 0) return mapa;

  // Firestore só aceita até 30 valores no "in" por consulta - divide em blocos
  for (let i = 0; i < idsGrupo.length; i += 30) {
    const bloco = idsGrupo.slice(i, i + 30);
    const snapshot = await getDocs(query(collection(db, "fotos"), where("grupoFotoId", "in", bloco)));
    snapshot.forEach((docSnap) => {
      const dados = docSnap.data();
      if (dados.pendente || !dados.alunoId) return; // só interessam os já confirmados
      if (!mapa.has(dados.grupoFotoId)) mapa.set(dados.grupoFotoId, []);
      mapa.get(dados.grupoFotoId).push({ id: dados.alunoId, nome: dados.alunoNome });
    });
  }
  return mapa;
}

function renderizarLista(docs, jaIdentificadosPorGrupo = new Map()) {
  if (docs.length === 0) {
    revisaoSubtitle.textContent = "Nenhuma foto pendente 🎉";
    revisaoList.innerHTML = `<p class="empty-state">Tudo revisado por aqui!</p>`;
    descartarTodasButton.hidden = true;
    itensPendentes = new Map();
    return;
  }

  // Agrupa por foto (vários rostos não identificados na mesma imagem
  // viram um grupo só, com todos os alunos aparecendo numa checklist
  // em vez de repetir a mesma foto várias vezes)
  const grupos = new Map(); // chave -> { docs: [{id, ...item}], item (dados representativos) }
  docs.forEach((docSnap) => {
    const item = docSnap.data();
    const chave = item.grupoFotoId || docSnap.id; // fotos antigas sem grupoFotoId viram grupo de 1
    if (!grupos.has(chave)) grupos.set(chave, { item, docs: [] });
    grupos.get(chave).docs.push({ id: docSnap.id, ...item });
  });

  revisaoSubtitle.textContent = `${docs.length} foto(s) aguardando identificação${grupos.size !== docs.length ? ` (${grupos.size} imagem(ns))` : ""}`;
  revisaoList.innerHTML = "";
  itensPendentes = grupos;
  descartarTodasButton.hidden = false;
  descartarTodasButton.textContent = `Descartar todas as fotos desta lista (${grupos.size})`;

  [...grupos.entries()].forEach(([grupoId, { item, docs: docsGrupo }]) => {
    const alunosDaTurma = alunosPorTurma[item.turma] || [];
    const jaIdentificados = jaIdentificadosPorGrupo.get(grupoId) || [];
    const idsJaIdentificados = new Set(jaIdentificados.map((a) => a.id));

    // Só mostra na checklist quem ainda não foi identificado nessa foto
    const opcoesAlunos = alunosDaTurma
      .filter((a) => !idsJaIdentificados.has(a.id))
      .map((a) => `<label class="revisao-aluno-opcao"><input type="checkbox" value="${a.id}" data-nome="${a.nome}"> ${a.nome}</label>`)
      .join("");

    const avisoJaIdentificados = jaIdentificados.length > 0
      ? `<p class="card-subtitle" style="margin: 2px 0; color: var(--color-teal);">✓ Já identificado(s) nesta foto: ${jaIdentificados.map((a) => a.nome).join(", ")}</p>`
      : "";

    const card = document.createElement("div");
    card.className = "result-item";
    card.innerHTML = `
      <img src="${item.foto}" alt="Foto pendente" class="result-photo result-photo--grande js-abrir-foto">
      <div class="result-faces">
        <span class="face-confidence">Turma: ${item.turma}${item.atividade ? ` · ${item.atividade}` : ""}</span>
        ${avisoJaIdentificados}
        <p class="card-subtitle" style="margin: 2px 0;">Tem mais alguém na foto? Marque quem falta.</p>
        <div class="revisao-alunos-checklist" data-grupo="${grupoId}">
          ${opcoesAlunos || "<span class=\"card-subtitle\">Todo mundo já foi identificado nessa foto.</span>"}
        </div>
        <div class="result-face">
          <button class="btn-ghost confirmar-btn" data-grupo="${grupoId}">Confirmar</button>
          <button class="btn-ghost descartar-btn" data-grupo="${grupoId}">Descartar</button>
        </div>
      </div>
    `;
    revisaoList.appendChild(card);
  });

  document.querySelectorAll(".confirmar-btn").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const grupoId = botao.getAttribute("data-grupo");
      const checklist = document.querySelector(`.revisao-alunos-checklist[data-grupo="${grupoId}"]`);
      const marcados = [...checklist.querySelectorAll("input:checked")].map((input) => ({
        id: input.value,
        nome: input.getAttribute("data-nome")
      }));

      if (marcados.length === 0) {
        alert("Marque ao menos um aluno antes de confirmar.");
        return;
      }

      const textoOriginal = botao.textContent;
      const { item, docs: docsGrupo } = itensPendentes.get(grupoId);

      try {
        const temArquivoNoDrive = docsGrupo[0] && docsGrupo[0].driveFileId && docsGrupo[0].drivePastaId;
        let accessToken = null;
        let pastaTurma = null;

        if (temArquivoNoDrive) {
          botao.disabled = true;
          accessToken = await garantirTokenAcesso();
          pastaTurma = await obterOuCriarPasta(item.turma, DRIVE_CONFIG.pastaRaizId, accessToken);
        }

        // Casa cada aluno marcado com um "arquivo" já existente do grupo
        // (um por rosto detectado na foto); usa mover pros primeiros e
        // copia pros excedentes
        const total = Math.max(marcados.length, docsGrupo.length);

        for (let i = 0; i < total; i++) {
          const aluno = marcados[i]; // pode faltar, se sobrou arquivo sem aluno
          const docOrigem = docsGrupo[i]; // pode faltar, se sobrou aluno sem arquivo próprio

          botao.textContent = `Processando (${i + 1}/${total})...`;

          if (aluno && docOrigem) {
            // Caso normal: aproveita o arquivo já enviado, só move de pasta
            if (temArquivoNoDrive) {
              const pastaAluno = await obterOuCriarPasta(aluno.nome, pastaTurma, accessToken);
              const pastaDestino = item.atividade
                ? await obterOuCriarPasta(item.atividade, pastaAluno, accessToken)
                : pastaAluno;
              await moverArquivo(docOrigem.driveFileId, docOrigem.drivePastaId, pastaDestino, accessToken);
            }
            await updateDoc(doc(db, "fotos", docOrigem.id), {
              alunoId: aluno.id,
              alunoNome: aluno.nome,
              pendente: false
            });
          } else if (aluno && !docOrigem) {
            // Mais alunos marcados do que arquivos no grupo: cria uma cópia
            let driveFileId = null, driveViewLink = null, drivePastaId = null;
            if (temArquivoNoDrive) {
              const pastaAluno = await obterOuCriarPasta(aluno.nome, pastaTurma, accessToken);
              const pastaDestino = item.atividade
                ? await obterOuCriarPasta(item.atividade, pastaAluno, accessToken)
                : pastaAluno;
              const copia = await copiarArquivo(docsGrupo[0].driveFileId, pastaDestino, `${aluno.nome}_${Date.now()}.jpg`, accessToken);
              driveFileId = copia.id;
              driveViewLink = copia.webViewLink;
              drivePastaId = pastaDestino;
            }
            await addDoc(collection(db, "fotos"), {
              alunoId: aluno.id,
              alunoNome: aluno.nome,
              turma: item.turma,
              atividade: item.atividade || null,
              foto: item.foto,
              driveFileId,
              driveViewLink,
              drivePastaId,
              pendente: false,
              criadoPor: item.criadoPor || null,
              criadoEm: serverTimestamp()
            });
          } else if (!aluno && docOrigem) {
            // Sobrou arquivo sem nenhum aluno marcado pra ele: exclui (redundante)
            if (temArquivoNoDrive && docOrigem.driveFileId) {
              await excluirArquivo(docOrigem.driveFileId, accessToken);
            }
            await deleteDoc(doc(db, "fotos", docOrigem.id));
          }
        }
      } catch (erro) {
        console.error(erro);
        alert(`Erro ao processar a foto no Drive:\n\n${erro.message || erro}`);
        botao.disabled = false;
        botao.textContent = textoOriginal;
      }
    });
  });

  document.querySelectorAll(".descartar-btn").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const grupoId = botao.getAttribute("data-grupo");
      const { docs: docsGrupo } = itensPendentes.get(grupoId);
      if (!confirm("Descartar esta foto? Essa ação não pode ser desfeita.")) return;

      try {
        const accessToken = docsGrupo.some((d) => d.driveFileId) ? await garantirTokenAcesso() : null;
        for (const docOrigem of docsGrupo) {
          if (docOrigem.driveFileId && accessToken) {
            await excluirArquivo(docOrigem.driveFileId, accessToken);
          }
          await deleteDoc(doc(db, "fotos", docOrigem.id));
        }
      } catch (erro) {
        console.error(erro);
        alert(`Erro ao excluir a foto:\n\n${erro.message || erro}`);
      }
    });
  });
}
