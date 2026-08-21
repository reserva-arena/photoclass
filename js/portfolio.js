// ============================================
// PhotoClass - Registros do Aluno
// ============================================
// Envio manual (sem reconhecimento facial) de fotos, vídeos ou
// documentos de tarefas pros registros de um aluno específico.
// Fica numa estrutura separada das fotos de atividade:
// [Turma] > Registros do Aluno > [Aluno] > [Data - Título] > arquivo(s)
//
// Como "Registros do Aluno" é uma subpasta dentro da própria pasta da turma,
// a professora já tem acesso automático (mesma permissão que ela já
// tem pra turma dela) - não precisa conceder acesso separado.

import { auth, db } from "./firebase-config.js?v=20260812i";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260819b";
import { TURMAS, NOMES_SEGMENTO } from "./turmas.js?v=20260812i";
import { garantirTokenAcesso, obterOuCriarPasta, obterPastaRaizDaTurma, enviarArquivo, definirEmailUsuario } from "./drive-upload.js?v=20260813a";
import { abrirCapturaCamera } from "./camera.js?v=20260812i";

// ---------- Elementos ----------
const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

const turmaSelect = document.getElementById("portfolio-turma-select");
const alunoField = document.getElementById("portfolio-aluno-field");
const alunoSelect = document.getElementById("portfolio-aluno-select");
const tituloModoField = document.getElementById("portfolio-titulo-modo-field");
const tituloModoNovoBtn = document.getElementById("titulo-modo-novo-btn");
const tituloModoExistenteBtn = document.getElementById("titulo-modo-existente-btn");
const tituloField = document.getElementById("portfolio-titulo-field");
const tituloInput = document.getElementById("portfolio-titulo-input");
const tituloExistenteField = document.getElementById("portfolio-titulo-existente-field");
const tituloExistenteSelect = document.getElementById("portfolio-titulo-existente-select");
const arquivosField = document.getElementById("portfolio-arquivos-field");
const arquivosInput = document.getElementById("portfolio-arquivos-input");
const enviarButton = document.getElementById("portfolio-enviar-button");
const portfolioError = document.getElementById("portfolio-error");
const portfolioSuccess = document.getElementById("portfolio-success");

const processingBanner = document.getElementById("processing-banner");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressText = document.getElementById("progress-text");

let usuarioAtual = null;
let turmasPermitidas = null;
let modoTitulo = "novo"; // "novo" ou "existente"

// ---------- Proteção da página ----------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    usuarioAtual = user;
    definirEmailUsuario(user.email);
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    configurarMenuMobile();
    configurarNavProfessores(user.email);

    obterTurmasPermitidas(user.email)
      .then((turmas) => {
        turmasPermitidas = turmas;
        preencherTurmas();
      })
      .catch((erro) => {
        console.error(erro);
        turmaSelect.innerHTML = `<option value="">Erro ao carregar turmas</option>`;
      });
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Turmas ----------
function preencherTurmas() {
  const turmasVisiveis = turmasPermitidas === null ? TURMAS : TURMAS.filter((t) => turmasPermitidas.includes(t.nome));

  if (turmasVisiveis.length === 0) {
    turmaSelect.innerHTML = `<option value="">Nenhuma turma liberada pra você</option>`;
    return;
  }

  const porSegmento = new Map();
  turmasVisiveis.forEach((t) => {
    if (!porSegmento.has(t.segmento)) porSegmento.set(t.segmento, []);
    porSegmento.get(t.segmento).push(t);
  });

  turmaSelect.innerHTML = `<option value="">Selecione a turma</option>` +
    [...porSegmento.entries()].map(([segmento, turmas]) => `
      <optgroup label="${NOMES_SEGMENTO[segmento] || segmento}">
        ${turmas.map((t) => `<option value="${t.nome}">${t.nome}</option>`).join("")}
      </optgroup>
    `).join("");
}

turmaSelect.addEventListener("change", async () => {
  const turma = turmaSelect.value;
  esconderMensagens();
  alunoField.hidden = !turma;
  tituloModoField.hidden = true;
  tituloField.hidden = true;
  tituloExistenteField.hidden = true;
  arquivosField.hidden = true;
  enviarButton.hidden = true;

  if (!turma) return;

  alunoSelect.innerHTML = `<option value="">Carregando alunos...</option>`;
  try {
    const snapshot = await getDocs(query(collection(db, "alunos"), where("turma", "==", turma)));
    const alunos = [];
    snapshot.forEach((docSnap) => alunos.push({ id: docSnap.id, nome: docSnap.data().nome }));
    alunos.sort((a, b) => a.nome.localeCompare(b.nome));

    if (alunos.length === 0) {
      alunoSelect.innerHTML = `<option value="">Nenhum aluno cadastrado nessa turma ainda</option>`;
      return;
    }

    alunoSelect.innerHTML = `<option value="">Selecione o aluno</option>` +
      alunos.map((a) => `<option value="${a.id}" data-nome="${a.nome}">${a.nome}</option>`).join("");
  } catch (erro) {
    console.error(erro);
    alunoSelect.innerHTML = `<option value="">Erro ao carregar alunos</option>`;
  }
});

alunoSelect.addEventListener("change", () => {
  const temAluno = Boolean(alunoSelect.value);
  tituloModoField.hidden = !temAluno;
  arquivosField.hidden = !temAluno;
  enviarButton.hidden = !temAluno;

  modoTitulo = "novo";
  tituloModoNovoBtn.classList.add("galeria-modo-btn--ativo");
  tituloModoExistenteBtn.classList.remove("galeria-modo-btn--ativo");
  tituloField.hidden = !temAluno;
  tituloExistenteField.hidden = true;
  tituloInput.value = "";

  if (temAluno) carregarTitulosRecentes();
  atualizarBotaoEnviar();
});

// Busca os títulos já usados pra esse aluno, pra poder "continuar"
// em vez de criar uma pasta nova por engano
async function carregarTitulosRecentes() {
  const turma = turmaSelect.value;
  const alunoId = alunoSelect.value;
  tituloExistenteSelect.innerHTML = `<option value="">Carregando...</option>`;

  try {
    const snapshot = await getDocs(
      query(collection(db, "portfolio"), where("turma", "==", turma), where("alunoId", "==", alunoId), orderBy("criadoEm", "desc"), limit(30))
    );
    const vistos = new Set();
    const titulos = [];
    snapshot.forEach((docSnap) => {
      const dados = docSnap.data();
      if (dados.titulo && !vistos.has(dados.titulo)) {
        vistos.add(dados.titulo);
        titulos.push({ titulo: dados.titulo, pastaId: dados.drivePastaId });
      }
    });

    if (titulos.length === 0) {
      tituloExistenteSelect.innerHTML = `<option value="">Nenhum título ainda pra esse aluno</option>`;
      return;
    }

    tituloExistenteSelect.innerHTML = `<option value="">Selecione o título</option>` +
      titulos.map((t) => `<option value="${t.pastaId}" data-titulo="${t.titulo}">${t.titulo}</option>`).join("");
  } catch (erro) {
    // Provavelmente falta o índice do Firestore (turma + alunoId + orderBy) - não trava a tela
    console.error("Erro ao carregar títulos recentes:", erro);
    tituloExistenteSelect.innerHTML = `<option value="">Não foi possível carregar - use "Novo título"</option>`;
  }
}

// ---------- Toggle Novo título / Continuar título existente ----------
tituloModoNovoBtn.addEventListener("click", () => {
  modoTitulo = "novo";
  tituloModoNovoBtn.classList.add("galeria-modo-btn--ativo");
  tituloModoExistenteBtn.classList.remove("galeria-modo-btn--ativo");
  tituloField.hidden = false;
  tituloExistenteField.hidden = true;
  atualizarBotaoEnviar();
});

tituloModoExistenteBtn.addEventListener("click", () => {
  modoTitulo = "existente";
  tituloModoExistenteBtn.classList.add("galeria-modo-btn--ativo");
  tituloModoNovoBtn.classList.remove("galeria-modo-btn--ativo");
  tituloField.hidden = true;
  tituloExistenteField.hidden = false;
  atualizarBotaoEnviar();
});

tituloExistenteSelect.addEventListener("change", atualizarBotaoEnviar);

tituloInput.addEventListener("input", atualizarBotaoEnviar);
arquivosInput.addEventListener("change", atualizarBotaoEnviar);

// Tirar fotos com a câmera do celular, sem sair do app - depois soma
// com o que já estiver selecionado no campo de arquivo (se houver)
document.getElementById("portfolio-camera-btn").addEventListener("click", async () => {
  const fotosCapturadas = await abrirCapturaCamera();
  if (fotosCapturadas.length === 0) return;

  const dt = new DataTransfer();
  [...arquivosInput.files, ...fotosCapturadas].forEach((arquivo) => dt.items.add(arquivo));
  arquivosInput.files = dt.files;
  arquivosInput.dispatchEvent(new Event("change"));
});

function atualizarBotaoEnviar() {
  const tituloOk = modoTitulo === "novo" ? Boolean(tituloInput.value.trim()) : Boolean(tituloExistenteSelect.value);
  enviarButton.disabled = !tituloOk || arquivosInput.files.length === 0;
}

function esconderMensagens() {
  portfolioError.hidden = true;
  portfolioSuccess.hidden = true;
}

// ---------- Progresso ----------
function iniciarProgresso() {
  processingBanner.hidden = false;
  atualizarProgresso(0, "Preparando...");
}
function atualizarProgresso(percentual, mensagem) {
  progressBarFill.style.width = `${Math.min(100, Math.max(0, percentual))}%`;
  progressText.textContent = mensagem;
}
function finalizarProgresso() {
  processingBanner.hidden = true;
}

// ---------- Enviar pros registros do aluno ----------
enviarButton.addEventListener("click", async () => {
  esconderMensagens();
  const turma = turmaSelect.value;
  const alunoOpcao = alunoSelect.selectedOptions[0];
  const alunoId = alunoOpcao.value;
  const alunoNome = alunoOpcao.getAttribute("data-nome");
  const titulo = modoTitulo === "existente"
    ? tituloExistenteSelect.selectedOptions[0]?.getAttribute("data-titulo")
    : tituloInput.value.trim();
  const arquivos = [...arquivosInput.files];

  if (!turma || !alunoId || !titulo || arquivos.length === 0) return;

  enviarButton.disabled = true;
  enviarButton.textContent = "Conectando ao Drive...";
  iniciarProgresso();
  atualizarProgresso(3, "Conectando ao Google Drive...");

  try {
    const accessToken = await garantirTokenAcesso();

    let pastaEnvio;
    if (modoTitulo === "existente") {
      // Já sabemos o ID da pasta - não precisa recriar o caminho
      pastaEnvio = tituloExistenteSelect.value;
    } else {
      const raizId = obterPastaRaizDaTurma(turma);
      const pastaTurma = await obterOuCriarPasta(turma, raizId, accessToken);
      const pastaPortfolio = await obterOuCriarPasta("Registros do Aluno", pastaTurma, accessToken);
      const pastaAluno = await obterOuCriarPasta(alunoNome, pastaPortfolio, accessToken);
      const dataHoje = new Date().toISOString().slice(0, 10);
      pastaEnvio = await obterOuCriarPasta(`${dataHoje} - ${titulo}`, pastaAluno, accessToken);
    }

    let enviados = 0;
    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i];
      atualizarProgresso(
        Math.round(((i + 0.5) / arquivos.length) * 100),
        `Enviando arquivo ${i + 1} de ${arquivos.length}...`
      );
      enviarButton.textContent = `Enviando ${i + 1}/${arquivos.length}...`;

      const nomeArquivo = arquivo.name || `arquivo_${Date.now()}_${i}`;
      const arquivoDrive = await enviarArquivo(arquivo, nomeArquivo, pastaEnvio, accessToken);

      await addDoc(collection(db, "portfolio"), {
        turma,
        alunoId,
        alunoNome,
        titulo,
        nomeArquivo,
        tipo: arquivo.type || "desconhecido",
        driveFileId: arquivoDrive.id,
        driveViewLink: arquivoDrive.webViewLink,
        drivePastaId: pastaEnvio,
        criadoPor: usuarioAtual.uid,
        criadoEm: serverTimestamp()
      });
      enviados++;
    }

    atualizarProgresso(100, "Concluído!");
    portfolioSuccess.textContent = `✅ ${enviados} arquivo(s) enviado(s) pros registros de ${alunoNome}!`;
    portfolioSuccess.hidden = false;

    tituloInput.value = "";
    arquivosInput.value = "";
    alunoSelect.value = "";
    modoTitulo = "novo";
    tituloModoNovoBtn.classList.add("galeria-modo-btn--ativo");
    tituloModoExistenteBtn.classList.remove("galeria-modo-btn--ativo");
    tituloModoField.hidden = true;
    tituloField.hidden = true;
    tituloExistenteField.hidden = true;
    arquivosField.hidden = true;
    enviarButton.hidden = true;
  } catch (erro) {
    console.error(erro);
    portfolioError.textContent = `Erro ao enviar: ${erro.message || erro}`;
    portfolioError.hidden = false;
  } finally {
    enviarButton.disabled = false;
    enviarButton.textContent = "Enviar";
    finalizarProgresso();
  }
});
