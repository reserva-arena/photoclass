// ============================================
// PhotoClass - Upload de Fotos + Reconhecimento Facial
// ============================================
// Usa face-api.js (baseado em TensorFlow.js) rodando
// direto no navegador do professor - nenhuma foto sai
// do dispositivo até o momento de salvar.

import { auth, db } from "./firebase-config.js?v=20260812i";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  documentId,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao, configurarNavProfessores, configurarMenuMobile, obterTurmasPermitidas } from "./roles.js?v=20260812i";
import { mostrarAlertaPendentes } from "./alerta-pendentes.js?v=20260812i";
import { garantirTokenAcesso, garantirTokenAcessoComEscolhaDeConta, obterEmailAutorizado, obterPastaDestino, enviarArquivo, definirEmailUsuario } from "./drive-upload.js?v=20260813a";
import { aprenderComFoto } from "./aprendizado.js?v=20260812i";
import { abrirCapturaCamera } from "./camera.js?v=20260812i";

const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
const LIMIAR_RECONHECIMENTO = 0.6; // quanto menor, mais rígido na comparação (acima disso = "não reconhecido")
const LIMIAR_ALTA_CONFIANCA = 0.55; // aceita automático quando similaridade >= 0.45 (distância = 1 - similaridade)
function ehAltaConfianca(face) {
  return Boolean(face.alunoId) && face.distancia < LIMIAR_ALTA_CONFIANCA && !face.duplicadoNaFoto;
}
const RESOLUCAO_DETECCAO = 608; // maior = detecta rostos menores melhor (fotos com várias pessoas), mas processa mais devagar
const LIMITE_FOTOS_POR_ENVIO = 50; // no celular, evita travar o navegador com envios gigantes de uma vez

// ---------- Elementos ----------
const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

const turmaSelect = document.getElementById("turma-select");
const uploadCard = document.getElementById("upload-card");
const uploadSubtitle = document.getElementById("upload-subtitle");
const atividadeModoNovaBtn = document.getElementById("atividade-modo-nova-btn");
const atividadeModoExistenteBtn = document.getElementById("atividade-modo-existente-btn");
const atividadeNovaField = document.getElementById("atividade-nova-field");
const atividadeExistenteField = document.getElementById("atividade-existente-field");
const atividadeInput = document.getElementById("atividade-input");
const atividadeExistenteSelect = document.getElementById("atividade-existente-select");
const fotosInput = document.getElementById("fotos-input");
const uploadError = document.getElementById("upload-error");
const uploadInfo = document.getElementById("upload-info");
const processButton = document.getElementById("process-button");
const processButtonText = document.getElementById("process-button-text");

const resultsCard = document.getElementById("results-card");
const resultsSubtitle = document.getElementById("results-subtitle");
const resultsList = document.getElementById("results-list");
const saveButton = document.getElementById("save-button");
const saveSuccess = document.getElementById("save-success");
const saveReviewLink = document.getElementById("save-review-link");

const processingBanner = document.getElementById("processing-banner");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressText = document.getElementById("progress-text");

let usuarioAtual = null;
let turmasPermitidas = null; // null = admin (todas); [] = nenhuma turma liberada ainda
let alunosDaTurma = []; // [{id, nome, foto}]
let modelosCarregados = false;
let resultadosProcessados = []; // [{ fotoDataUrl, faces: [{alunoId, alunoNome, distancia}] }]
let modoAtividade = "nova"; // "nova" ou "existente"

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
    obterTurmasPermitidas(user.email).then((turmas) => {
      turmasPermitidas = turmas;
      carregarTurmas();
      mostrarAlertaPendentes(turmas);
    });
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Carregar turmas disponíveis ----------
async function carregarTurmas() {
  // Professora sem turma liberada ainda: nem mostra o formulário
  if (turmasPermitidas !== null && turmasPermitidas.length === 0) {
    turmaSelect.innerHTML = `<option value="">Nenhuma turma liberada pra você</option>`;
    return;
  }

  // Já sabemos exatamente quais turmas ela pode usar - não precisa nem consultar o Firestore
  if (turmasPermitidas !== null) {
    turmaSelect.innerHTML = `<option value="">Selecione uma turma</option>`;
    [...turmasPermitidas].sort().forEach((turma) => {
      const option = document.createElement("option");
      option.value = turma;
      option.textContent = turma;
      turmaSelect.appendChild(option);
    });
    return;
  }

  // Admin: mostra todas as turmas que já têm algum aluno cadastrado
  const alunosRef = collection(db, "alunos");
  const consulta = query(alunosRef);
  const snapshot = await getDocs(consulta);

  const turmas = new Set();
  snapshot.forEach((docSnap) => turmas.add(docSnap.data().turma));

  turmaSelect.innerHTML = `<option value="">Selecione uma turma</option>`;
  [...turmas].sort().forEach((turma) => {
    const option = document.createElement("option");
    option.value = turma;
    option.textContent = turma;
    turmaSelect.appendChild(option);
  });

  if (turmas.size === 0) {
    turmaSelect.innerHTML = `<option value="">Nenhum aluno cadastrado ainda</option>`;
  }
}

turmaSelect.addEventListener("change", async () => {
  const turma = turmaSelect.value;
  resultsCard.hidden = true;
  uploadCard.hidden = !turma;
  if (!turma) return;

  const alunosRef = collection(db, "alunos");
  const consulta = query(alunosRef, where("turma", "==", turma));
  const snapshot = await getDocs(consulta);

  // Busca as fotos de referência (documento separado, mais pesado) em
  // lote pra esses alunos - só nessa tela, que é onde de fato precisa
  // pra reconhecer rostos. Se der erro (ex: regra do Firestore ainda
  // não atualizada), não trava a tela - cai no plano B (fotos antigas
  // guardadas direto no documento do aluno, se existirem).
  const idsAlunos = snapshot.docs.map((d) => d.id);
  const referenciaPorAluno = new Map();
  try {
    for (let i = 0; i < idsAlunos.length; i += 30) {
      const bloco = idsAlunos.slice(i, i + 30);
      if (bloco.length === 0) continue;
      const refSnapshot = await getDocs(query(collection(db, "alunos_referencia"), where(documentId(), "in", bloco)));
      refSnapshot.forEach((docSnap) => referenciaPorAluno.set(docSnap.id, docSnap.data()));
    }
  } catch (erro) {
    console.error("Erro ao buscar fotos de referência (alunos_referencia) - usando fotos antigas do documento do aluno, se houver:", erro);
  }

  alunosDaTurma = [];
  snapshot.forEach((docSnap) => {
    const dado = docSnap.data();
    const ref = referenciaPorAluno.get(docSnap.id);
    // Compatível com cadastros antigos, que ainda podem ter as fotos
    // direto no documento principal (antes dessa separação)
    const fotosCadastradas = ref?.fotos && ref.fotos.length > 0
      ? ref.fotos
      : (dado.fotos && dado.fotos.length > 0 ? dado.fotos : (dado.foto ? [dado.foto] : []));
    const fotosAprendidas = ref?.fotosAprendidas || dado.fotosAprendidas || [];
    const fotos = [...fotosCadastradas, ...fotosAprendidas];
    alunosDaTurma.push({ id: docSnap.id, nome: dado.nome, fotos });
  });

  uploadSubtitle.textContent = `${alunosDaTurma.length} aluno(s) nessa turma`;
  carregarAtividadesRecentes(turma);
});

// Busca as atividades mais recentes dessa turma, pra popular o select
// de "continuar uma atividade" - evita a professora ter que digitar de
// novo (e arriscar criar uma pasta duplicada por causa de um typo)
async function carregarAtividadesRecentes(turma) {
  atividadeExistenteSelect.innerHTML = `<option value="">Carregando...</option>`;
  try {
    const snapshot = await getDocs(
      query(collection(db, "fotos"), where("turma", "==", turma), orderBy("criadoEm", "desc"), limit(60))
    );
    const vistas = new Set();
    const atividades = [];
    snapshot.forEach((docSnap) => {
      const atividade = docSnap.data().atividade;
      if (atividade && !vistas.has(atividade)) {
        vistas.add(atividade);
        atividades.push(atividade);
      }
    });

    if (atividades.length === 0) {
      atividadeExistenteSelect.innerHTML = `<option value="">Nenhuma atividade recente nessa turma ainda</option>`;
      return;
    }

    atividadeExistenteSelect.innerHTML = `<option value="">Selecione a atividade</option>` +
      atividades.slice(0, 20).map((a) => {
        const { dataFormatada, nome } = separarDataEAtividade(a);
        return `<option value="${a}">${dataFormatada ? `${dataFormatada} - ` : ""}${nome}</option>`;
      }).join("");
  } catch (erro) {
    // Provavelmente falta o índice do Firestore (turma + orderBy criadoEm) - não trava a tela
    console.error("Erro ao carregar atividades recentes:", erro);
    atividadeExistenteSelect.innerHTML = `<option value="">Não foi possível carregar - use "Nova atividade"</option>`;
  }
}

function separarDataEAtividade(atividade) {
  const match = atividade.match(/^(\d{4})-(\d{2})-(\d{2}) - (.+)$/);
  if (!match) return { dataFormatada: "", nome: atividade };
  const [, ano, mes, dia] = match;
  return { dataFormatada: `${dia}/${mes}/${ano}`, nome: match[4] };
}

// ---------- Toggle Nova atividade / Continuar atividade existente ----------
atividadeModoNovaBtn.addEventListener("click", () => {
  modoAtividade = "nova";
  atividadeModoNovaBtn.classList.add("galeria-modo-btn--ativo");
  atividadeModoExistenteBtn.classList.remove("galeria-modo-btn--ativo");
  atividadeNovaField.hidden = false;
  atividadeExistenteField.hidden = true;
});

atividadeModoExistenteBtn.addEventListener("click", () => {
  modoAtividade = "existente";
  atividadeModoExistenteBtn.classList.add("galeria-modo-btn--ativo");
  atividadeModoNovaBtn.classList.remove("galeria-modo-btn--ativo");
  atividadeNovaField.hidden = true;
  atividadeExistenteField.hidden = false;
});

fotosInput.addEventListener("change", () => {
  const total = fotosInput.files.length;
  if (total > LIMITE_FOTOS_POR_ENVIO) {
    uploadError.textContent = `Selecione no máximo ${LIMITE_FOTOS_POR_ENVIO} fotos por vez (você selecionou ${total}). Envie em grupos menores - use "Continuar uma atividade" pra juntar tudo na mesma pasta depois.`;
    uploadError.hidden = false;
    fotosInput.value = "";
    processButton.disabled = true;
    return;
  }
  uploadError.hidden = true;
  uploadInfo.hidden = true;
  processButton.disabled = total === 0;
});

// Tirar fotos com a câmera do celular, sem sair do app - depois soma
// com o que já estiver selecionado no campo de arquivo (se houver)
document.getElementById("fotos-camera-btn").addEventListener("click", async () => {
  const fotosCapturadas = await abrirCapturaCamera();
  if (fotosCapturadas.length === 0) return;

  const dt = new DataTransfer();
  [...fotosInput.files, ...fotosCapturadas].forEach((arquivo) => dt.items.add(arquivo));
  fotosInput.files = dt.files;
  fotosInput.dispatchEvent(new Event("change"));
});

// ---------- Carregar modelos do face-api.js ----------
async function carregarModelos() {
  if (modelosCarregados) return;
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  modelosCarregados = true;
}

// ---------- Barra de progresso + aviso de não fechar a aba ----------
let emProcessamento = false;

window.addEventListener("beforeunload", (evento) => {
  if (!emProcessamento) return;
  evento.preventDefault();
  evento.returnValue = ""; // necessário pro navegador mostrar o aviso nativo
});

function iniciarProgresso() {
  emProcessamento = true;
  processingBanner.hidden = false;
  atualizarProgresso(0, "Preparando...");
}

function atualizarProgresso(percentual, mensagem) {
  progressBarFill.style.width = `${Math.min(100, Math.max(0, percentual))}%`;
  progressText.textContent = mensagem;
}

function finalizarProgresso() {
  emProcessamento = false;
  processingBanner.hidden = true;
}

// ---------- Utilitários de imagem ----------
function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function arquivoParaDataUrl(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

// Gera uma "impressão digital" do conteúdo do arquivo, pra detectar duplicatas
// mesmo quando o nome do arquivo é diferente
async function hashArquivo(arquivo) {
  const buffer = await arquivo.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Remove arquivos com conteúdo idêntico, mantendo só a primeira ocorrência
async function removerDuplicatas(arquivos) {
  const vistos = new Set();
  const unicos = [];
  let duplicadas = 0;

  for (const arquivo of arquivos) {
    const hash = await hashArquivo(arquivo);
    if (vistos.has(hash)) {
      duplicadas++;
      continue;
    }
    vistos.add(hash);
    unicos.push(arquivo);
  }

  return { unicos, duplicadas };
}

// Reduz o tamanho da imagem antes de guardar (evita estourar o Firestore)
function redimensionar(img, maxDim = 480, qualidade = 0.7) {
  const canvas = document.createElement("canvas");
  let { width, height } = img;
  if (width > height && width > maxDim) {
    height = Math.round(height * (maxDim / width));
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round(width * (maxDim / height));
    height = maxDim;
  }
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", qualidade);
}

// Versão em qualidade maior da foto (não a miniatura), usada no
// upload de verdade pro Drive - alvo de ~500KB, boa pra tela/celular
function comprimirParaEnvio(img, maxDim = 1600, qualidade = 0.85) {
  const canvas = document.createElement("canvas");
  let { width, height } = img;
  if (width > height && width > maxDim) {
    height = Math.round(height * (maxDim / width));
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round(width * (maxDim / height));
    height = maxDim;
  }
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", qualidade));
}

// ---------- Processar fotos ----------
processButton.addEventListener("click", async () => {
  uploadError.hidden = true;
  uploadInfo.hidden = true;

  if (modoAtividade === "nova" && !atividadeInput.value.trim()) {
    uploadError.textContent = "Preencha o nome da atividade antes de continuar.";
    uploadError.hidden = false;
    atividadeInput.focus();
    return;
  }

  if (modoAtividade === "existente" && !atividadeExistenteSelect.value) {
    uploadError.textContent = "Selecione a atividade que você quer continuar.";
    uploadError.hidden = false;
    atividadeExistenteSelect.focus();
    return;
  }

  processButton.disabled = true;
  processButtonText.textContent = "Carregando reconhecimento facial...";
  iniciarProgresso();
  atualizarProgresso(2, "Carregando modelo de reconhecimento facial...");

  try {
    await carregarModelos();

    // Monta os descritores de referência (rosto de cada aluno da turma,
    // usando TODAS as fotos de referência cadastradas pra ele - melhora
    // a precisão em ângulos/expressões diferentes)
    processButtonText.textContent = "Analisando alunos da turma...";
    atualizarProgresso(10, "Analisando fotos de referência da turma...");
    const descritoresConhecidos = [];
    const alunosSemRostoDetectado = [];
    for (const aluno of alunosDaTurma) {
      const descritoresDoAluno = [];

      for (const fotoReferencia of aluno.fotos) {
        try {
          const img = await carregarImagem(fotoReferencia);
          const deteccao = await faceapi
            .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: RESOLUCAO_DETECCAO }))
            .withFaceLandmarks()
            .withFaceDescriptor();

          if (deteccao) descritoresDoAluno.push(deteccao.descriptor);
        } catch {
          // essa foto específica falhou - segue tentando as outras
        }
      }

      if (descritoresDoAluno.length > 0) {
        descritoresConhecidos.push(
          new faceapi.LabeledFaceDescriptors(aluno.id, descritoresDoAluno)
        );
      } else {
        alunosSemRostoDetectado.push(aluno.nome);
      }
    }

    if (alunosSemRostoDetectado.length > 0) {
      uploadError.textContent = `Atenção: não foi possível detectar rosto na foto de referência de: ${alunosSemRostoDetectado.join(", ")}. Esses alunos NUNCA serão reconhecidos até a foto de referência ser trocada por uma mais nítida/de frente.`;
      uploadError.hidden = false;
    }

    if (descritoresConhecidos.length === 0) {
      uploadError.textContent = "Não foi possível reconhecer nenhum rosto nas fotos de referência dessa turma.";
      uploadError.hidden = false;
      return;
    }

    const comparador = new faceapi.FaceMatcher(descritoresConhecidos, LIMIAR_RECONHECIMENTO);

    // Processa cada foto enviada
    processButtonText.textContent = "Verificando fotos repetidas...";
    resultadosProcessados = [];
    const arquivosOriginais = [...fotosInput.files];
    const { unicos: arquivos, duplicadas } = await removerDuplicatas(arquivosOriginais);

    if (duplicadas > 0) {
      uploadInfo.textContent = `${duplicadas} foto(s) repetida(s) encontrada(s) e ignorada(s). Processando ${arquivos.length} foto(s) única(s).`;
      uploadInfo.hidden = false;
    } else {
      uploadInfo.hidden = true;
    }

    processButtonText.textContent = "Reconhecendo rostos nas fotos...";
    atualizarProgresso(25, `Reconhecendo rostos... (0/${arquivos.length})`);

    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i];
      const dataUrl = await arquivoParaDataUrl(arquivo);
      const img = await carregarImagem(dataUrl);

      const deteccoes = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: RESOLUCAO_DETECCAO }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      const faces = deteccoes.map((deteccao) => {
        const melhorMatch = comparador.findBestMatch(deteccao.descriptor);
        const alunoId = melhorMatch.label === "unknown" ? null : melhorMatch.label;
        const aluno = alunosDaTurma.find((a) => a.id === alunoId);
        return {
          alunoId: aluno ? aluno.id : null,
          alunoNome: aluno ? aluno.nome : null,
          distancia: melhorMatch.distance
        };
      });

      // Segurança: se o mesmo aluno "bateu" em mais de um rosto na MESMA
      // foto, é sinal de erro (a mesma criança não aparece duas vezes na
      // mesma imagem) - força revisão manual nesses casos, mesmo com
      // confiança alta
      const contagemPorAluno = {};
      faces.forEach((f) => {
        if (f.alunoId) contagemPorAluno[f.alunoId] = (contagemPorAluno[f.alunoId] || 0) + 1;
      });
      faces.forEach((f) => {
        if (f.alunoId && contagemPorAluno[f.alunoId] > 1) f.duplicadoNaFoto = true;
      });

      // Se não detectou nenhum rosto (óculos, ângulo, contraluz...), não
      // descarta a foto - mantém como pendente pra identificação manual,
      // em vez de perder ela
      if (faces.length === 0) {
        faces.push({ alunoId: null, alunoNome: null, distancia: 1, semDeteccao: true });
      }

      resultadosProcessados.push({
        arquivoOriginal: arquivo,
        fotoDataUrl: redimensionar(img),
        faces
      });

      // 25% a 95% da barra é reservado pro reconhecimento das fotos
      const percentual = 25 + Math.round(((i + 1) / arquivos.length) * 70);
      atualizarProgresso(percentual, `Reconhecendo rostos... (${i + 1}/${arquivos.length})`);
    }

    atualizarProgresso(100, "Concluído!");
    renderizarResultados();
  } catch (erro) {
    console.error(erro);
    uploadError.textContent = "Ocorreu um erro ao processar as fotos. Tente novamente.";
    uploadError.hidden = false;
  } finally {
    processButton.disabled = false;
    processButtonText.textContent = "Reconhecer rostos";
    finalizarProgresso();
  }
});

// ---------- Exibir resultados com opção de correção manual ----------
function renderizarResultados() {
  resultsCard.hidden = false;
  saveSuccess.hidden = true;

  const totalFotos = resultadosProcessados.length;
  const totalRostos = resultadosProcessados.reduce((soma, r) => soma + r.faces.length, 0);
  const totalAutomaticos = resultadosProcessados.reduce(
    (soma, r) => soma + r.faces.filter(ehAltaConfianca).length,
    0
  );

  resultsSubtitle.textContent = totalAutomaticos > 0
    ? `${totalFotos} foto(s) processada(s), ${totalRostos} rosto(s) — ${totalAutomaticos} reconhecido(s) automaticamente, ${totalRostos - totalAutomaticos} para conferir`
    : `${totalFotos} foto(s) processada(s), ${totalRostos} rosto(s) encontrado(s)`;

  resultsList.innerHTML = "";

  const resolvidasHtml = [];
  const precisamAtencaoHtml = [];

  resultadosProcessados.forEach((resultado, indiceFoto) => {
    const opcoesAlunos = alunosDaTurma
      .map((a) => `<option value="${a.id}">${a.nome}</option>`)
      .join("");

    // Rostos com alta confiança: selo verde + opção de corrigir (igual antes)
    const facesAutoComIndice = resultado.faces
      .map((face, indiceFace) => ({ face, indiceFace }))
      .filter(({ face }) => ehAltaConfianca(face));

    const facesAutoHtml = facesAutoComIndice.map(({ face, indiceFace }) => `
        <div class="result-face face-auto" data-foto="${indiceFoto}" data-face="${indiceFace}">
          <div class="face-auto-badge">
            <span class="face-auto-check">✓</span>
            <span>${face.alunoNome}</span>
            <button type="button" class="face-auto-corrigir" data-foto="${indiceFoto}" data-face="${indiceFace}">Não é esse aluno? Corrigir</button>
          </div>
          <select data-foto="${indiceFoto}" data-face="${indiceFace}" class="face-select" hidden>
            <option value="">Aguardando identificação</option>
            ${opcoesAlunos}
            <option value="__ignorar__">Ignorar (não é aluno)</option>
          </select>
        </div>
      `).join("");

    // Rostos que precisam de conferência manual: uma checklist só,
    // em vez de um seletor pra cada um (evita repetir a turma inteira
    // várias vezes numa foto de grupo)
    const facesParaConferir = resultado.faces.filter((face) => !ehAltaConfianca(face));
    const idsJaAutoNaFoto = new Set(facesAutoComIndice.map(({ face }) => face.alunoId));
    const alunosParaChecklist = alunosDaTurma.filter((a) => !idsJaAutoNaFoto.has(a.id));

    const checklistHtml = facesParaConferir.length === 0 ? "" : `
      <div class="result-face">
        <p class="card-subtitle" style="margin: 0 0 6px;">
          ${facesParaConferir.length} rosto(s) pra conferir nessa foto${facesParaConferir.some((f) => f.semDeteccao) ? " (algum não foi detectado automaticamente)" : ""} - marque quem aparece:
        </p>
        <div class="revisao-alunos-checklist foto-checklist" data-foto="${indiceFoto}">
          ${alunosParaChecklist.map((a) => `<label class="revisao-aluno-opcao"><input type="checkbox" value="${a.id}" data-nome="${a.nome}"> ${a.nome}</label>`).join("")}
        </div>
      </div>
    `;

    const totalmenteResolvida = facesParaConferir.length === 0 && facesAutoComIndice.length > 0;

    if (totalmenteResolvida) {
      // Compacta: só a miniatura, os nomes, e um botão pra abrir os
      // detalhes (corrigir / descartar) só se precisar
      const nomes = facesAutoComIndice.map(({ face }) => face.alunoNome).join(", ");
      resolvidasHtml.push(`
        <div class="foto-resolvida result-item" data-foto="${indiceFoto}">
          <img src="${resultado.fotoDataUrl}" alt="Foto ${indiceFoto + 1}" class="foto-resolvida-img js-abrir-foto">
          <div class="foto-resolvida-info">
            <span class="foto-resolvida-nomes">✓ ${nomes}</span>
            <button type="button" class="foto-resolvida-detalhes-btn" data-foto="${indiceFoto}">Detalhes / corrigir</button>
          </div>
          <div class="foto-resolvida-detalhes" data-foto="${indiceFoto}" hidden>
            ${facesAutoHtml}
            <label class="foto-ignorar-opcao">
              <input type="checkbox" class="foto-ignorar-checkbox" data-foto="${indiceFoto}">
              ⚠️ Está errado? Desconsidere esta foto (não é da turma / não interessa)
            </label>
          </div>
        </div>
      `);
    } else {
      precisamAtencaoHtml.push(`
        <div class="result-item" data-foto="${indiceFoto}">
          <img src="${resultado.fotoDataUrl}" alt="Foto ${indiceFoto + 1}" class="result-photo result-photo--grande js-abrir-foto">
          <div class="result-faces">
            ${facesAutoHtml}${checklistHtml}
            <label class="foto-ignorar-opcao">
              <input type="checkbox" class="foto-ignorar-checkbox" data-foto="${indiceFoto}">
              ⚠️ Está errado? Desconsidere esta foto (não é da turma / não interessa)
            </label>
          </div>
        </div>
      `);
    }
  });

  resultsList.innerHTML =
    (precisamAtencaoHtml.length > 0 ? precisamAtencaoHtml.join("") : "") +
    (resolvidasHtml.length > 0 ? `
      <p class="card-subtitle" style="margin: 14px 0 6px;">✅ ${resolvidasHtml.length} foto(s) já reconhecida(s) automaticamente (nada a fazer)</p>
      <div class="fotos-resolvidas-grid">${resolvidasHtml.join("")}</div>
    ` : "");

  // Pré-seleciona os selects escondidos dos rostos automáticos, com o
  // aluno já reconhecido (senão ficariam vazios até clicar em "Corrigir")
  resultadosProcessados.forEach((resultado, indiceFoto) => {
    resultado.faces.forEach((face, indiceFace) => {
      if (!ehAltaConfianca(face)) return;
      const select = resultsList.querySelector(`select[data-foto="${indiceFoto}"][data-face="${indiceFace}"]`);
      if (select) select.value = face.alunoId;
    });
  });

  // Botão "Detalhes / corrigir" abre a área escondida da foto compacta
  resultsList.querySelectorAll(".foto-resolvida-detalhes-btn").forEach((botao) => {
    botao.addEventListener("click", () => {
      const detalhes = resultsList.querySelector(`.foto-resolvida-detalhes[data-foto="${botao.getAttribute("data-foto")}"]`);
      detalhes.hidden = !detalhes.hidden;
      botao.textContent = detalhes.hidden ? "Detalhes / corrigir" : "Esconder";
    });
  });

  // Botão "Corrigir" troca o selo automático pelo select de verdade
  resultsList.querySelectorAll(".face-auto-corrigir").forEach((botao) => {
    botao.addEventListener("click", () => {
      const linha = botao.closest(".face-auto");
      const badge = linha.querySelector(".face-auto-badge");
      const select = linha.querySelector(".face-select");
      badge.hidden = true;
      select.hidden = false;
      const foto = Number(select.getAttribute("data-foto"));
      const face = Number(select.getAttribute("data-face"));
      const dadosFace = resultadosProcessados[foto].faces[face];
      if (dadosFace.alunoId) select.value = dadosFace.alunoId;
    });
  });

  // Zoom ao clicar na foto (mesmo padrão da Revisão/Galeria)
  resultsList.querySelectorAll(".js-abrir-foto").forEach((img) => {
    img.addEventListener("click", () => {
      const overlay = document.createElement("div");
      overlay.className = "lightbox-overlay";
      overlay.innerHTML = `<img src="${img.src}" alt="Foto ampliada">`;
      overlay.addEventListener("click", () => overlay.remove());
      document.body.appendChild(overlay);
    });
  });

  // Ao marcar "não salvar", desabilita visualmente o resto da foto
  resultsList.querySelectorAll(".foto-ignorar-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const item = checkbox.closest(".result-item");
      item.classList.toggle("result-item--ignorada", checkbox.checked);
      item.querySelectorAll("select, input[type=checkbox]:not(.foto-ignorar-checkbox), button.face-auto-corrigir")
        .forEach((el) => { el.disabled = checkbox.checked; });
    });
  });

  saveButton.hidden = totalRostos === 0;
}

// ---------- Salvar fotos confirmadas ----------
saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  saveButton.textContent = "Conectando ao Drive...";
  saveReviewLink.style.display = "none";
  iniciarProgresso();
  atualizarProgresso(3, "Conectando ao Google Drive...");

  // Guardado fora do try pra poder usar no catch (diagnóstico de qual
  // conta autorizou), mesmo que o erro aconteça depois de obter o token
  let accessTokenParaDiagnostico = null;

  try {
    // Pede autorização à professora pra subir arquivos no Drive
    // (aparece uma janela do Google só na primeira vez da sessão)
    const accessToken = await garantirTokenAcesso();
    accessTokenParaDiagnostico = accessToken;

    const turma = turmaSelect.value;
    const dataHoje = new Date().toISOString().slice(0, 10); // AAAA-MM-DD
    const nomeAtividade = modoAtividade === "existente"
      ? atividadeExistenteSelect.value
      : `${dataHoje} - ${atividadeInput.value.trim()}`;

    // Fotos marcadas como "não salvar nenhuma foto desta imagem"
    const fotosIgnoradas = new Set(
      [...document.querySelectorAll(".foto-ignorar-checkbox:checked")].map((el) => Number(el.getAttribute("data-foto")))
    );

    // Monta a lista de tudo que precisa ser enviado: os rostos com selo
    // automático (via select escondido) + os marcados manualmente na
    // checklist de cada foto
    const itensParaEnviar = []; // { indiceFoto, aluno: {id,nome} | null, pendente }
    let rostosDescartadosAutomatico = 0;

    document.querySelectorAll(".face-select").forEach((select) => {
      if (select.value === "__ignorar__") return;
      const indiceFoto = Number(select.getAttribute("data-foto"));
      if (fotosIgnoradas.has(indiceFoto)) return;
      const pendente = select.value === "";
      const aluno = pendente ? null : alunosDaTurma.find((a) => a.id === select.value);

      // Só "aprende" quando foi uma CORREÇÃO manual de verdade (a
      // professora trocou o palpite automático) - nunca de um automático
      // aceito sem revisão, pra não reforçar um erro
      const indiceFace = Number(select.getAttribute("data-face"));
      const faceOriginal = resultadosProcessados[indiceFoto]?.faces[indiceFace];
      const aprender = Boolean(aluno) && faceOriginal && faceOriginal.alunoId !== aluno.id;

      itensParaEnviar.push({ indiceFoto, aluno, pendente, aprender });
    });

    resultadosProcessados.forEach((resultado, indiceFoto) => {
      if (fotosIgnoradas.has(indiceFoto)) return;
      const facesParaConferir = resultado.faces.filter((face) => !ehAltaConfianca(face));
      if (facesParaConferir.length === 0) return;

      const checklist = resultsList.querySelector(`.foto-checklist[data-foto="${indiceFoto}"]`);
      const marcados = checklist
        ? [...checklist.querySelectorAll("input:checked")].map((input) => ({ id: input.value, nome: input.getAttribute("data-nome") }))
        : [];

      // Sem ambiguidade só quando é 1 rosto pra 1 aluno marcado - em fotos
      // de grupo não dá pra saber com certeza qual rosto é qual, então
      // não ensina o sistema nesses casos
      const semAmbiguidade = facesParaConferir.length === 1 && marcados.length === 1;

      // Se a turma inteira já foi identificada nessa foto (automáticos +
      // marcados aqui), qualquer rosto que sobrar não pode ser de
      // nenhum aluno - descarta na hora, sem nem subir pro Drive, em
      // vez de mandar pra Revisão perguntar de novo pra ninguém
      const idsAutoNestaFoto = resultado.faces.filter(ehAltaConfianca).map((f) => f.alunoId);
      const totalIdentificadosNestaFoto = new Set([...idsAutoNestaFoto, ...marcados.map((m) => m.id)]).size;
      const turmaEsgotadaNestaFoto = totalIdentificadosNestaFoto >= alunosDaTurma.length;

      // Casa cada rosto pendente com um aluno marcado; se sobrar aluno
      // marcado, cria envio extra; se sobrar rosto sem ninguém marcado
      // (e ainda tiver aluno da turma sem aparecer nessa foto), vai
      // como pendente pra Revisão (não perde a foto)
      const total = Math.max(facesParaConferir.length, marcados.length);
      for (let i = 0; i < total; i++) {
        const aluno = marcados[i] || null;
        if (!aluno && turmaEsgotadaNestaFoto) {
          rostosDescartadosAutomatico++;
          continue;
        }
        itensParaEnviar.push({ indiceFoto, aluno, pendente: !aluno, aprender: semAmbiguidade && Boolean(aluno) });
      }
    });

    let salvos = 0;
    let pendentesSalvos = 0;
    const gruposPorFoto = new Map(); // indiceFoto -> ID compartilhado entre todos os rostos dessa mesma imagem

    for (let indice = 0; indice < itensParaEnviar.length; indice++) {
      const { indiceFoto, aluno, pendente, aprender } = itensParaEnviar[indice];
      saveButton.textContent = `Enviando ${indice + 1}/${itensParaEnviar.length}...`;
      atualizarProgresso(
        Math.round(((indice + 0.5) / itensParaEnviar.length) * 100),
        `Enviando foto ${indice + 1} de ${itensParaEnviar.length} pro Drive...`
      );

      const resultado = resultadosProcessados[indiceFoto];

      // Aprende com essa confirmação (só quando não teve ambiguidade
      // nenhuma) - roda em paralelo, não atrasa o envio da foto
      if (aprender) aprenderComFoto(aluno.id, resultado.fotoDataUrl);

      if (!gruposPorFoto.has(indiceFoto)) gruposPorFoto.set(indiceFoto, crypto.randomUUID());
      const grupoFotoId = gruposPorFoto.get(indiceFoto);

      // Gera a versão em qualidade maior (não a miniatura) a partir
      // do arquivo original, pra subir no Drive
      const dataUrlOriginal = await arquivoParaDataUrl(resultado.arquivoOriginal);
      const imgOriginal = await carregarImagem(dataUrlOriginal);
      const blobEnvio = await comprimirParaEnvio(imgOriginal);

      // Acha (ou cria) a pasta certa: Turma > Aluno > Atividade, ou
      // Turma > "Não identificados" > Atividade se ainda não sabemos quem é
      const pastaDestinoId = await obterPastaDestino(
        { turma, alunoNome: aluno ? aluno.nome : null, pendente, atividade: nomeAtividade },
        accessToken
      );

      const nomeBase = (aluno ? aluno.nome : "nao-identificado").replace(/[\\/:*?"<>|]/g, "_");
      const nomeArquivo = `${nomeBase}_${Date.now()}_${indice}.jpg`;
      const arquivoDrive = await enviarArquivo(blobEnvio, nomeArquivo, pastaDestinoId, accessToken);

      await addDoc(collection(db, "fotos"), {
        alunoId: pendente ? null : aluno.id,
        alunoNome: pendente ? null : aluno.nome,
        turma,
        atividade: nomeAtividade,
        foto: resultado.fotoDataUrl, // miniatura, só pra exibir dentro do app
        driveFileId: arquivoDrive.id,
        driveViewLink: arquivoDrive.webViewLink,
        drivePastaId: pastaDestinoId,
        grupoFotoId,
        pendente,
        criadoPor: usuarioAtual.uid,
        criadoEm: serverTimestamp()
      });
      salvos++;
      if (pendente) pendentesSalvos++;
    }

    atualizarProgresso(100, "Concluído!");
    saveSuccess.textContent = `✅ ${salvos} foto(s) salva(s) com sucesso no Google Drive! Já pode apagar essas fotos do celular, se quiser liberar espaço.`
      + (rostosDescartadosAutomatico > 0 ? ` (${rostosDescartadosAutomatico} rosto(s) extra(s) ignorado(s) automaticamente - a turma toda já tinha sido identificada nessa(s) foto(s))` : "");
    saveSuccess.hidden = false;

    if (pendentesSalvos > 0) {
      saveReviewLink.textContent = `👉 Ver ${pendentesSalvos} foto(s) pendente(s) na Revisão`;
      saveReviewLink.classList.remove("save-review-link--ok");
    } else {
      saveReviewLink.textContent = `🎉 Nenhuma foto pendente - tudo já identificado!`;
      saveReviewLink.classList.add("save-review-link--ok");
    }
    saveReviewLink.href = `revisao.html?turma=${encodeURIComponent(turma)}`;
    saveReviewLink.style.display = "block";

    // Atualiza a faixa de alerta do topo na hora (senão só atualizaria
    // se a página fosse recarregada)
    mostrarAlertaPendentes(turmasPermitidas);

    resultsCard.hidden = true;
    fotosInput.value = "";
    atividadeInput.value = "";
    processButton.disabled = true;
    carregarAtividadesRecentes(turma);
  } catch (erro) {
    console.error(erro);

    // Descobre qual conta Google autorizou (se algum token chegou a ser
    // obtido), pra deixar claro na mensagem se é a conta errada - é a causa
    // mais comum desse tipo de erro ("File not found" numa pasta que existe)
    let emailAutorizado = null;
    if (accessTokenParaDiagnostico) {
      emailAutorizado = await obterEmailAutorizado(accessTokenParaDiagnostico);
    }

    const linhaConta = emailAutorizado
      ? `\n\nConta do Google autorizada no momento: ${emailAutorizado}\n(se esse não for o e-mail da escola, é isso - toque em OK e troque de conta a seguir)`
      : "";

    const quiserTrocarDeConta = confirm(
      `Erro ao salvar as fotos no Drive:\n\n${erro.message || erro}${linhaConta}\n\nDeseja trocar de conta agora e tentar de novo?`
    );

    if (quiserTrocarDeConta) {
      try {
        await garantirTokenAcessoComEscolhaDeConta();
        alert("Conta atualizada. Toque em \"Salvar fotos confirmadas\" de novo pra tentar salvar as fotos.");
      } catch {
        alert("Não foi possível trocar de conta. Tente sair e entrar de novo no PhotoClass.");
      }
    }
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Salvar fotos confirmadas";
    finalizarProgresso();
  }
});
