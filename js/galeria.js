// ============================================
// PhotoClass - Galeria
// ============================================
// Navegação Turma > Aluno > Atividade > Fotos, usando os dados já
// guardados no Firestore (miniatura, link do Drive) - sem precisar
// consultar o Google Drive ao vivo, então é rápido pra qualquer um
// que tenha acesso ao app (não exige autorização do Drive).

import { auth, db } from "./firebase-config.js?v=20260727u";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260727u";
import {
  garantirTokenAcesso,
  obterOuCriarPasta,
  compartilharPasta,
  verificarCompartilhamento,
  removerCompartilhamento
} from "./drive-upload.js?v=20260727u";
import { DRIVE_CONFIG } from "./drive-config.js?v=20260727u";

const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");
const galeriaSubtitle = document.getElementById("galeria-subtitle");
const galeriaBreadcrumb = document.getElementById("galeria-breadcrumb");
const galeriaCompartilhar = document.getElementById("galeria-compartilhar");
const galeriaTurmaField = document.getElementById("galeria-turma-field");
const galeriaTurmaSelect = document.getElementById("galeria-turma-select");
const galeriaVazio = document.getElementById("galeria-vazio");
const galeriaGrid = document.getElementById("galeria-grid");

let turmasPermitidas = null;
let fotosDaTurma = []; // fotos confirmadas (pendente:false) da turma selecionada
let turmaAtual = null;
let alunoAtual = null; // { id, nome }
let atividadeAtual = null; // string

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    configurarMenuMobile();
    configurarNavProfessores(user.email);

    obterTurmasPermitidas(user.email).then((turmas) => {
      turmasPermitidas = turmas;
      preencherTurmas();
    });
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Passo 0: escolher a turma ----------
function preencherTurmas() {
  if (turmasPermitidas !== null && turmasPermitidas.length === 0) {
    galeriaTurmaField.hidden = true;
    galeriaVazio.hidden = false;
    galeriaVazio.textContent = "Você ainda não tem nenhuma turma liberada. Fale com o administrador do PhotoClass.";
    return;
  }

  const turmas = turmasPermitidas === null ? null : turmasPermitidas;
  if (turmas) {
    galeriaTurmaSelect.innerHTML = `<option value="">Selecione uma turma</option>`;
    [...turmas].sort().forEach((turma) => {
      const option = document.createElement("option");
      option.value = turma;
      option.textContent = turma;
      galeriaTurmaSelect.appendChild(option);
    });
  } else {
    // Admin: descobre as turmas que já têm alguma foto confirmada
    getDocs(query(collection(db, "fotos"), where("pendente", "==", false))).then((snapshot) => {
      const turmasComFoto = new Set();
      snapshot.forEach((docSnap) => turmasComFoto.add(docSnap.data().turma));
      galeriaTurmaSelect.innerHTML = `<option value="">Selecione uma turma</option>`;
      [...turmasComFoto].sort().forEach((turma) => {
        const option = document.createElement("option");
        option.value = turma;
        option.textContent = turma;
        galeriaTurmaSelect.appendChild(option);
      });
    });
  }
}

galeriaTurmaSelect.addEventListener("change", async () => {
  turmaAtual = galeriaTurmaSelect.value;
  alunoAtual = null;
  atividadeAtual = null;

  if (!turmaAtual) {
    galeriaGrid.innerHTML = "";
    galeriaBreadcrumb.hidden = true;
    return;
  }

  galeriaGrid.innerHTML = `<p class="empty-state">Carregando...</p>`;
  const snapshot = await getDocs(query(collection(db, "fotos"), where("turma", "==", turmaAtual)));
  fotosDaTurma = [];
  snapshot.forEach((docSnap) => {
    const dados = docSnap.data();
    if (dados.pendente || !dados.alunoId) return; // só fotos já identificadas
    fotosDaTurma.push({ id: docSnap.id, ...dados });
  });

  renderizarAlunos();
});

// ---------- Breadcrumb ----------
function renderizarBreadcrumb() {
  const partes = [];
  partes.push(`<button data-nivel="turma">${turmaAtual}</button>`);
  if (alunoAtual) partes.push(`<span class="galeria-separador">›</span><button data-nivel="aluno">${alunoAtual.nome}</button>`);
  if (atividadeAtual) partes.push(`<span class="galeria-separador">›</span><span class="galeria-atual">${atividadeAtual}</span>`);

  galeriaBreadcrumb.innerHTML = partes.join(" ");
  galeriaBreadcrumb.hidden = false;

  galeriaBreadcrumb.querySelectorAll("button").forEach((botao) => {
    botao.addEventListener("click", () => {
      const nivel = botao.getAttribute("data-nivel");
      if (nivel === "turma") {
        alunoAtual = null;
        atividadeAtual = null;
        renderizarAlunos();
      } else if (nivel === "aluno") {
        atividadeAtual = null;
        renderizarAtividades();
      }
    });
  });
}

// ---------- Nível 1: Alunos da turma ----------
function renderizarAlunos() {
  galeriaBreadcrumb.hidden = true;
  galeriaCompartilhar.hidden = true;
  galeriaVazio.hidden = true;

  if (fotosDaTurma.length === 0) {
    galeriaGrid.innerHTML = "";
    galeriaVazio.hidden = false;
    galeriaVazio.textContent = "Nenhuma foto identificada ainda nessa turma.";
    return;
  }

  const porAluno = new Map(); // alunoId -> { nome, fotos: [...] }
  fotosDaTurma.forEach((foto) => {
    if (!porAluno.has(foto.alunoId)) porAluno.set(foto.alunoId, { nome: foto.alunoNome, fotos: [] });
    porAluno.get(foto.alunoId).fotos.push(foto);
  });

  galeriaGrid.innerHTML = "";
  [...porAluno.entries()]
    .sort((a, b) => a[1].nome.localeCompare(b[1].nome))
    .forEach(([alunoId, dados]) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "galeria-card";
      card.innerHTML = `
        <img src="${dados.fotos[0].foto}" alt="${dados.nome}" class="galeria-card-capa">
        <div class="galeria-card-info">
          <span class="galeria-card-nome">${dados.nome}</span>
          <span class="galeria-card-contagem">${dados.fotos.length} foto(s)</span>
        </div>
      `;
      card.addEventListener("click", () => {
        alunoAtual = { id: alunoId, nome: dados.nome };
        renderizarAtividades();
      });
      galeriaGrid.appendChild(card);
    });
}

// ---------- Nível 2: Atividades do aluno ----------
function renderizarAtividades() {
  renderizarBreadcrumb();
  renderizarCompartilhar();

  const fotosDoAluno = fotosDaTurma.filter((f) => f.alunoId === alunoAtual.id);
  const porAtividade = new Map(); // atividade -> { fotos: [...], drivePastaId }
  fotosDoAluno.forEach((foto) => {
    const chave = foto.atividade || "Sem atividade";
    if (!porAtividade.has(chave)) porAtividade.set(chave, { fotos: [] });
    porAtividade.get(chave).fotos.push(foto);
  });

  galeriaGrid.innerHTML = "";
  [...porAtividade.entries()]
    .sort((a, b) => b[0].localeCompare(a[0])) // mais recente primeiro (data no nome)
    .forEach(([atividade, dados]) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "galeria-card";
      card.innerHTML = `
        <img src="${dados.fotos[0].foto}" alt="${atividade}" class="galeria-card-capa">
        <div class="galeria-card-info">
          <span class="galeria-card-nome">${atividade}</span>
          <span class="galeria-card-contagem">${dados.fotos.length} foto(s)</span>
        </div>
      `;
      card.addEventListener("click", () => {
        atividadeAtual = atividade;
        renderizarFotos();
      });
      galeriaGrid.appendChild(card);
    });
}

// ---------- Nível 3: Fotos da atividade ----------
function renderizarFotos() {
  renderizarBreadcrumb();
  renderizarCompartilhar();

  const fotos = fotosDaTurma.filter((f) => f.alunoId === alunoAtual.id && (f.atividade || "Sem atividade") === atividadeAtual);

  // Link pra abrir a pasta dessa atividade direto no Drive (qualidade original, dá pra baixar tudo de uma vez)
  const pastaId = fotos.find((f) => f.drivePastaId)?.drivePastaId;
  const linkPasta = pastaId
    ? `<a href="https://drive.google.com/drive/folders/${pastaId}" target="_blank" rel="noopener" class="galeria-abrir-drive">📁 Abrir esta pasta no Google Drive (baixar tudo)</a>`
    : "";

  galeriaGrid.innerHTML = linkPasta + `<div class="galeria-grid" id="galeria-fotos-grid"></div>`;
  const grid = document.getElementById("galeria-fotos-grid");

  fotos.forEach((foto) => {
    const wrapper = document.createElement("div");
    wrapper.className = "galeria-foto-wrapper";
    wrapper.innerHTML = `
      <img src="${foto.foto}" alt="Foto de ${alunoAtual.nome}" class="js-abrir-foto-galeria">
      ${foto.driveViewLink ? `<a href="${foto.driveViewLink}" target="_blank" rel="noopener" class="galeria-foto-drive-link">Abrir no Drive</a>` : ""}
    `;
    grid.appendChild(wrapper);
  });
}

// ---------- Compartilhar pasta do aluno com os pais ----------
function renderizarCompartilhar() {
  galeriaCompartilhar.hidden = false;
  galeriaCompartilhar.innerHTML = `
    <button id="galeria-compartilhar-btn" class="btn-ghost">🔗 Gerar/ver link para os pais (ver e baixar as fotos deste aluno)</button>
    <div id="galeria-compartilhar-resultado"></div>
  `;

  document.getElementById("galeria-compartilhar-btn").addEventListener("click", async (evento) => {
    const botao = evento.target;
    const resultado = document.getElementById("galeria-compartilhar-resultado");
    botao.disabled = true;
    botao.textContent = "Verificando...";

    try {
      const accessToken = await garantirTokenAcesso();
      const pastaTurma = await obterOuCriarPasta(turmaAtual, DRIVE_CONFIG.pastaRaizId, accessToken);
      const pastaAluno = await obterOuCriarPasta(alunoAtual.nome, pastaTurma, accessToken);

      let compartilhamento = await verificarCompartilhamento(pastaAluno, accessToken);
      if (!compartilhamento) {
        botao.textContent = "Gerando link...";
        const link = await compartilharPasta(pastaAluno, accessToken);
        compartilhamento = { link, id: null };
        // busca de novo pra pegar o id da permissão (necessário caso queira remover depois)
        compartilhamento = (await verificarCompartilhamento(pastaAluno, accessToken)) || compartilhamento;
      }

      resultado.innerHTML = `
        <p class="card-subtitle" style="margin: 8px 0 4px;">Qualquer pessoa com esse link consegue ver e baixar as fotos de ${alunoAtual.nome} (sem poder apagar nada):</p>
        <div class="galeria-compartilhar-link">
          <input type="text" readonly value="${compartilhamento.link}" onclick="this.select()">
          <button class="btn-ghost" id="galeria-copiar-link">Copiar link</button>
          <button class="btn-ghost" id="galeria-remover-link">Remover acesso</button>
        </div>
      `;

      document.getElementById("galeria-copiar-link").addEventListener("click", async () => {
        await navigator.clipboard.writeText(compartilhamento.link);
        const btnCopiar = document.getElementById("galeria-copiar-link");
        btnCopiar.textContent = "Copiado ✓";
        setTimeout(() => { btnCopiar.textContent = "Copiar link"; }, 2000);
      });

      document.getElementById("galeria-remover-link").addEventListener("click", async () => {
        if (!confirm("Remover o acesso? O link para de funcionar pros pais.")) return;
        if (compartilhamento.id) {
          await removerCompartilhamento(pastaAluno, compartilhamento.id, accessToken);
        }
        renderizarCompartilhar();
      });

      botao.textContent = "🔗 Gerar/ver link para os pais (ver e baixar as fotos deste aluno)";
      botao.disabled = false;
    } catch (erro) {
      console.error(erro);
      alert(`Erro ao gerar o link:\n\n${erro.message || erro}`);
      botao.disabled = false;
      botao.textContent = "🔗 Gerar/ver link para os pais (ver e baixar as fotos deste aluno)";
    }
  });
}

// ---------- Zoom nas fotos (mesmo padrão da Revisão) ----------
galeriaGrid.addEventListener("click", (evento) => {
  if (!evento.target.classList.contains("js-abrir-foto-galeria")) return;
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `<img src="${evento.target.src}" alt="Foto ampliada">`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
});
