// ============================================
// PhotoClass - Galeria
// ============================================
// Navegação Turma > Aluno > Atividade > Fotos, usando os dados já
// guardados no Firestore (miniatura, link do Drive) - sem precisar
// consultar o Google Drive ao vivo, então é rápido pra qualquer um
// que tenha acesso ao app (não exige autorização do Drive).

import { auth, db } from "./firebase-config.js?v=20260728g";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260728g";
import {
  garantirTokenAcesso,
  obterOuCriarPasta,
  compartilharComEmail,
  listarAcessosPorEmail,
  removerCompartilhamento
} from "./drive-upload.js?v=20260728g";
import { DRIVE_CONFIG } from "./drive-config.js?v=20260728g";

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
let alunosDaTurma = []; // [{id, nome, foto}] - leve, vem do cadastro, não das fotos
let fotosDoAlunoAtual = []; // só as fotos do aluno que está aberto agora (vai crescendo conforme pagina)
let ultimoDocPaginacao = null; // cursor pra buscar a próxima leva de fotos mais antigas
let semMaisFotosAntigas = false; // true = já buscou tudo desse aluno
let indiceQueryFallback = false; // true = Firestore ainda não tem o índice, usando busca sem paginação
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

  let concluido = false;
  setTimeout(() => {
    if (!concluido) {
      galeriaGrid.innerHTML = `<p class="empty-state">Isso está demorando demais - verifique sua conexão e aguarde mais um pouco, ou tente atualizar a página.</p>`;
    }
  }, 10000);

  try {
    // Busca só os alunos da turma (leve - não depende de quantas fotos
    // já foram enviadas ao longo do ano, sempre rápido)
    const snapshot = await getDocs(query(collection(db, "alunos"), where("turma", "==", turmaAtual)));
    alunosDaTurma = [];
    snapshot.forEach((docSnap) => {
      const dados = docSnap.data();
      const foto = (dados.fotos && dados.fotos[0]) || dados.foto;
      alunosDaTurma.push({ id: docSnap.id, nome: dados.nome, foto });
    });
    concluido = true;
    renderizarAlunos();
  } catch (erro) {
    concluido = true;
    console.error(erro);
    galeriaGrid.innerHTML = `<p class="empty-state">Erro ao carregar os alunos: ${erro.message || erro}. Tente atualizar a página.</p>`;
  }
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

  if (alunosDaTurma.length === 0) {
    galeriaGrid.innerHTML = "";
    galeriaVazio.hidden = false;
    galeriaVazio.textContent = "Nenhum aluno cadastrado ainda nessa turma.";
    return;
  }

  galeriaGrid.innerHTML = "";
  [...alunosDaTurma]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .forEach((aluno) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "galeria-card";
      card.innerHTML = `
        <img src="${aluno.foto}" alt="${aluno.nome}" class="galeria-card-capa">
        <div class="galeria-card-info">
          <span class="galeria-card-nome">${aluno.nome}</span>
        </div>
      `;
      card.addEventListener("click", () => abrirAluno(aluno));
      galeriaGrid.appendChild(card);
    });
}

// Busca as fotos só desse aluno específico, em levas pequenas (não tudo
// de uma vez) - rápido sempre, mesmo que a turma acumule muitas fotos
// ao longo do ano. Cada leva cobre normalmente 1-2 atividades.
const TAMANHO_DA_LEVA = 20;

async function abrirAluno(aluno) {
  alunoAtual = aluno;
  atividadeAtual = null;
  fotosDoAlunoAtual = [];
  ultimoDocPaginacao = null;
  semMaisFotosAntigas = false;
  indiceQueryFallback = false;

  renderizarBreadcrumb();
  galeriaGrid.innerHTML = `<p class="empty-state">Carregando fotos de ${aluno.nome}...</p>`;

  try {
    await buscarMaisFotosDoAluno();
    renderizarAtividades();
  } catch (erro) {
    console.error(erro);
    galeriaGrid.innerHTML = `<p class="empty-state">Erro ao carregar as fotos: ${erro.message || erro}.</p>`;
  }
}

// Busca a próxima leva de fotos mais antigas desse aluno (usado tanto
// na primeira abertura quanto no botão "ver mais antigas")
async function buscarMaisFotosDoAluno() {
  if (semMaisFotosAntigas) return;

  const fotosRef = collection(db, "fotos");

  try {
    if (indiceQueryFallback) {
      // Já caiu no plano B antes (sem índice) - não dá pra paginar,
      // então essa função não faz mais nada depois da primeira busca
      return;
    }

    const restricoes = [
      where("turma", "==", turmaAtual),
      where("alunoId", "==", alunoAtual.id),
      orderBy("criadoEm", "desc")
    ];
    if (ultimoDocPaginacao) restricoes.push(startAfter(ultimoDocPaginacao));
    restricoes.push(limit(TAMANHO_DA_LEVA));

    const snapshot = await getDocs(query(fotosRef, ...restricoes));

    snapshot.forEach((docSnap) => {
      const dados = docSnap.data();
      if (dados.pendente) return; // só fotos já identificadas
      fotosDoAlunoAtual.push({ id: docSnap.id, ...dados });
    });

    if (snapshot.size > 0) ultimoDocPaginacao = snapshot.docs[snapshot.docs.length - 1];
    semMaisFotosAntigas = snapshot.size < TAMANHO_DA_LEVA;
  } catch (erroIndice) {
    // Índice ainda não criado no Firestore - busca tudo de uma vez só
    // (mais lento, mas funciona). O link pra criar o índice de vez
    // aparece no console do navegador.
    console.warn("Paginação indisponível (falta criar um índice no Firestore) - buscando tudo de uma vez. Detalhes:", erroIndice.message);
    indiceQueryFallback = true;
    semMaisFotosAntigas = true;

    const snapshot = await getDocs(query(fotosRef, where("turma", "==", turmaAtual), where("alunoId", "==", alunoAtual.id)));
    fotosDoAlunoAtual = [];
    snapshot.forEach((docSnap) => {
      const dados = docSnap.data();
      if (dados.pendente) return;
      fotosDoAlunoAtual.push({ id: docSnap.id, ...dados });
    });
  }
}

// ---------- Nível 2: Atividades do aluno ----------
function renderizarAtividades() {
  renderizarBreadcrumb();
  renderizarCompartilhar();

  const porAtividade = new Map(); // atividade -> { fotos: [...] }
  fotosDoAlunoAtual.forEach((foto) => {
    const chave = foto.atividade || "Sem atividade";
    if (!porAtividade.has(chave)) porAtividade.set(chave, { fotos: [] });
    porAtividade.get(chave).fotos.push(foto);
  });

  const atividadesOrdenadas = [...porAtividade.entries()].sort((a, b) => b[0].localeCompare(a[0])); // mais recente primeiro

  if (atividadesOrdenadas.length === 0) {
    galeriaGrid.innerHTML = `<p class="empty-state">Nenhuma foto identificada ainda desse aluno.</p>`;
    return;
  }

  galeriaGrid.innerHTML = "";
  atividadesOrdenadas.forEach(([atividade, dados]) => {
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

  if (!semMaisFotosAntigas) {
    const botaoMais = document.createElement("button");
    botaoMais.type = "button";
    botaoMais.className = "btn-ghost";
    botaoMais.style.marginTop = "12px";
    botaoMais.textContent = "Ver atividades mais antigas";
    botaoMais.addEventListener("click", async () => {
      botaoMais.disabled = true;
      botaoMais.textContent = "Buscando...";
      await buscarMaisFotosDoAluno();
      renderizarAtividades();
    });
    galeriaGrid.appendChild(botaoMais);
  }
}

// ---------- Nível 3: Fotos da atividade ----------
function renderizarFotos() {
  renderizarBreadcrumb();
  renderizarCompartilhar();

  const fotos = fotosDoAlunoAtual.filter((f) => (f.atividade || "Sem atividade") === atividadeAtual);

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

// ---------- Compartilhar pasta do aluno com os pais (por e-mail específico) ----------
async function renderizarCompartilhar() {
  galeriaCompartilhar.hidden = false;
  galeriaCompartilhar.innerHTML = `<p class="card-subtitle">Carregando...</p>`;

  const alunoSnap = await getDoc(doc(db, "alunos", alunoAtual.id));
  const emails = (alunoSnap.exists() && alunoSnap.data().emailsResponsaveis) || [];

  galeriaCompartilhar.innerHTML = `
    <p class="card-subtitle" style="margin-bottom: 8px;">
      Compartilhar as fotos de ${alunoAtual.nome} por e-mail específico - só quem estiver logado com essa conta Google consegue ver e baixar, sem poder apagar nada.
    </p>
    <div id="galeria-emails-lista">
      ${emails.map((email) => `
        <div class="galeria-email-item">
          <span>${email}</span>
          <button class="btn-ghost galeria-email-acao-btn" data-email="${email}">Verificando...</button>
        </div>
      `).join("")}
    </div>
    ${emails.length === 0 ? `<p class="card-subtitle">Nenhum e-mail de responsável cadastrado ainda pra ${alunoAtual.nome}. Adicione abaixo (também salva pro cadastro do aluno).</p>` : ""}
    <div class="galeria-compartilhar-link">
      <input type="email" id="galeria-novo-email" placeholder="email-do-responsavel@gmail.com">
      <button class="btn-ghost" id="galeria-adicionar-email">+ Adicionar e compartilhar</button>
    </div>
  `;

  let accessTokenCache = null;
  let pastaAlunoId = null;
  async function garantirPastaEToken() {
    if (!accessTokenCache) accessTokenCache = await garantirTokenAcesso();
    if (!pastaAlunoId) {
      const pastaTurma = await obterOuCriarPasta(turmaAtual, DRIVE_CONFIG.pastaRaizId, accessTokenCache);
      pastaAlunoId = await obterOuCriarPasta(alunoAtual.nome, pastaTurma, accessTokenCache);
    }
    return { accessToken: accessTokenCache, pastaAluno: pastaAlunoId };
  }

  async function atualizarBotoesDeStatus() {
    const botoes = [...document.querySelectorAll(".galeria-email-acao-btn")];
    if (botoes.length === 0) return;
    try {
      const { accessToken, pastaAluno } = await garantirPastaEToken();
      const acessos = await listarAcessosPorEmail(pastaAluno, accessToken);
      botoes.forEach((botao) => {
        const email = botao.getAttribute("data-email");
        const permissao = acessos.find((p) => p.emailAddress?.toLowerCase() === email.toLowerCase());
        if (permissao) {
          botao.textContent = "✓ Compartilhado - Remover acesso";
          botao.dataset.permissaoId = permissao.id;
        } else {
          botao.textContent = "Compartilhar";
          delete botao.dataset.permissaoId;
        }
      });
    } catch (erro) {
      console.error(erro);
      botoes.forEach((botao) => { botao.textContent = "Compartilhar"; });
    }
  }

  atualizarBotoesDeStatus();

  document.querySelectorAll(".galeria-email-acao-btn").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const email = botao.getAttribute("data-email");
      const textoOriginal = botao.textContent;
      botao.disabled = true;

      try {
        const { accessToken, pastaAluno } = await garantirPastaEToken();
        if (botao.dataset.permissaoId) {
          if (!confirm(`Remover o acesso de ${email}?`)) {
            botao.disabled = false;
            return;
          }
          await removerCompartilhamento(pastaAluno, botao.dataset.permissaoId, accessToken);
        } else {
          botao.textContent = "Compartilhando...";
          await compartilharComEmail(pastaAluno, email, accessToken);
        }
        await atualizarBotoesDeStatus();
      } catch (erro) {
        console.error(erro);
        alert(`Erro:\n\n${erro.message || erro}`);
        botao.textContent = textoOriginal;
      } finally {
        botao.disabled = false;
      }
    });
  });

  document.getElementById("galeria-adicionar-email").addEventListener("click", async () => {
    const input = document.getElementById("galeria-novo-email");
    const email = input.value.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      alert("Digite um e-mail válido.");
      return;
    }

    const botaoAdicionar = document.getElementById("galeria-adicionar-email");
    botaoAdicionar.disabled = true;
    botaoAdicionar.textContent = "Adicionando...";

    try {
      const novaLista = [...new Set([...emails, email])];
      await updateDoc(doc(db, "alunos", alunoAtual.id), { emailsResponsaveis: novaLista });

      const { accessToken, pastaAluno } = await garantirPastaEToken();
      await compartilharComEmail(pastaAluno, email, accessToken);

      renderizarCompartilhar(); // recarrega a lista já com o novo e-mail
    } catch (erro) {
      console.error(erro);
      alert(`Erro ao adicionar/compartilhar:\n\n${erro.message || erro}`);
      botaoAdicionar.disabled = false;
      botaoAdicionar.textContent = "+ Adicionar e compartilhar";
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
