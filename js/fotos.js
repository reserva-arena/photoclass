// ============================================
// PhotoClass - Upload de Fotos + Reconhecimento Facial
// ============================================
// Usa face-api.js (baseado em TensorFlow.js) rodando
// direto no navegador do professor - nenhuma foto sai
// do dispositivo até o momento de salvar.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configurarAlternadorVisao } from "./roles.js";
import { garantirTokenAcesso, obterPastaDestino, enviarArquivo } from "./drive-upload.js";

const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
const LIMIAR_RECONHECIMENTO = 0.6; // quanto menor, mais rígido na comparação (acima disso = "não reconhecido")
const LIMIAR_ALTA_CONFIANCA = 0.45; // abaixo disso, aceita automaticamente sem pedir revisão (nível "equilibrado")

// ---------- Elementos ----------
const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

const turmaSelect = document.getElementById("turma-select");
const uploadCard = document.getElementById("upload-card");
const uploadSubtitle = document.getElementById("upload-subtitle");
const atividadeInput = document.getElementById("atividade-input");
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

let usuarioAtual = null;
let alunosDaTurma = []; // [{id, nome, foto}]
let modelosCarregados = false;
let resultadosProcessados = []; // [{ fotoDataUrl, faces: [{alunoId, alunoNome, distancia}] }]

// ---------- Proteção da página ----------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    usuarioAtual = user;
    userEmailLabel.textContent = user.email;
    configurarAlternadorVisao(user.email);
    carregarTurmas();
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- Carregar turmas disponíveis ----------
async function carregarTurmas() {
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

  alunosDaTurma = [];
  snapshot.forEach((docSnap) => {
    const dado = docSnap.data();
    alunosDaTurma.push({ id: docSnap.id, nome: dado.nome, foto: dado.foto });
  });

  uploadSubtitle.textContent = `${alunosDaTurma.length} aluno(s) nessa turma`;
});

fotosInput.addEventListener("change", () => {
  processButton.disabled = fotosInput.files.length === 0;
});

// ---------- Carregar modelos do face-api.js ----------
async function carregarModelos() {
  if (modelosCarregados) return;
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  modelosCarregados = true;
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

  if (!atividadeInput.value.trim()) {
    uploadError.textContent = "Preencha o nome da atividade antes de continuar.";
    uploadError.hidden = false;
    atividadeInput.focus();
    return;
  }

  processButton.disabled = true;
  processButtonText.textContent = "Carregando reconhecimento facial...";

  try {
    await carregarModelos();

    // Monta os descritores de referência (rosto de cada aluno da turma)
    processButtonText.textContent = "Analisando alunos da turma...";
    const descritoresConhecidos = [];
    const alunosSemRostoDetectado = [];
    for (const aluno of alunosDaTurma) {
      try {
        const img = await carregarImagem(aluno.foto);
        const deteccao = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (deteccao) {
          descritoresConhecidos.push(
            new faceapi.LabeledFaceDescriptors(aluno.id, [deteccao.descriptor])
          );
        } else {
          alunosSemRostoDetectado.push(aluno.nome);
        }
      } catch {
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

    for (const arquivo of arquivos) {
      const dataUrl = await arquivoParaDataUrl(arquivo);
      const img = await carregarImagem(dataUrl);

      const deteccoes = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
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

      resultadosProcessados.push({
        arquivoOriginal: arquivo,
        fotoDataUrl: redimensionar(img),
        faces
      });
    }

    renderizarResultados();
  } catch (erro) {
    console.error(erro);
    uploadError.textContent = "Ocorreu um erro ao processar as fotos. Tente novamente.";
    uploadError.hidden = false;
  } finally {
    processButton.disabled = false;
    processButtonText.textContent = "Reconhecer rostos";
  }
});

// ---------- Exibir resultados com opção de correção manual ----------
function renderizarResultados() {
  resultsCard.hidden = false;
  saveSuccess.hidden = true;

  const totalFotos = resultadosProcessados.length;
  const totalRostos = resultadosProcessados.reduce((soma, r) => soma + r.faces.length, 0);
  const totalAutomaticos = resultadosProcessados.reduce(
    (soma, r) => soma + r.faces.filter((f) => f.alunoId && f.distancia < LIMIAR_ALTA_CONFIANCA).length,
    0
  );

  resultsSubtitle.textContent = totalAutomaticos > 0
    ? `${totalFotos} foto(s) processada(s), ${totalRostos} rosto(s) — ${totalAutomaticos} reconhecido(s) automaticamente, ${totalRostos - totalAutomaticos} para conferir`
    : `${totalFotos} foto(s) processada(s), ${totalRostos} rosto(s) encontrado(s)`;

  resultsList.innerHTML = "";

  resultadosProcessados.forEach((resultado, indiceFoto) => {
    const item = document.createElement("div");
    item.className = "result-item";

    const opcoesAlunos = alunosDaTurma
      .map((a) => `<option value="${a.id}">${a.nome}</option>`)
      .join("");

    const facesHtml = resultado.faces.length === 0
      ? `<p class="empty-state">Nenhum rosto detectado nessa foto.</p>`
      : resultado.faces.map((face, indiceFace) => {
          const altaConfianca = face.alunoId && face.distancia < LIMIAR_ALTA_CONFIANCA;

          if (altaConfianca) {
            // Reconhecido com alta confiança: já vai como confirmado,
            // só mostra um selo + opção de corrigir se estiver errado
            return `
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
            `;
          }

          return `
            <div class="result-face">
              <select data-foto="${indiceFoto}" data-face="${indiceFace}" class="face-select">
                <option value="">Aguardando identificação</option>
                ${opcoesAlunos}
                <option value="__ignorar__">Ignorar (não é aluno)</option>
              </select>
              <span class="face-confidence">${face.alunoId ? `similaridade: ${(1 - face.distancia).toFixed(2)}` : "não reconhecido"}</span>
            </div>
          `;
        }).join("");

    item.innerHTML = `
      <img src="${resultado.fotoDataUrl}" alt="Foto ${indiceFoto + 1}" class="result-photo">
      <div class="result-faces">${facesHtml}</div>
    `;
    resultsList.appendChild(item);

    // Pré-seleciona os selects (tanto os visíveis quanto os escondidos dos automáticos)
    resultado.faces.forEach((face, indiceFace) => {
      const select = item.querySelector(`select[data-foto="${indiceFoto}"][data-face="${indiceFace}"]`);
      if (select && face.alunoId) select.value = face.alunoId;
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
    });
  });

  saveButton.hidden = totalRostos === 0;
}

// ---------- Salvar fotos confirmadas ----------
saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  saveButton.textContent = "Conectando ao Drive...";

  try {
    // Pede autorização à professora pra subir arquivos no Drive
    // (aparece uma janela do Google só na primeira vez da sessão)
    const accessToken = await garantirTokenAcesso();

    const turma = turmaSelect.value;
    const dataHoje = new Date().toISOString().slice(0, 10); // AAAA-MM-DD
    const nomeAtividade = `${dataHoje} - ${atividadeInput.value.trim()}`;

    const selects = [...document.querySelectorAll(".face-select")].filter(
      (select) => select.value !== "__ignorar__" // ignora fotos descartadas
    );
    let salvos = 0;

    for (let indice = 0; indice < selects.length; indice++) {
      const select = selects[indice];
      saveButton.textContent = `Enviando ${indice + 1}/${selects.length}...`;

      const valor = select.value;
      const indiceFoto = Number(select.getAttribute("data-foto"));
      const resultado = resultadosProcessados[indiceFoto];
      const pendente = valor === "";
      const aluno = pendente ? null : alunosDaTurma.find((a) => a.id === valor);

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
        pendente,
        criadoPor: usuarioAtual.uid,
        criadoEm: serverTimestamp()
      });
      salvos++;
    }

    saveSuccess.textContent = `${salvos} foto(s) salva(s) com sucesso no Google Drive!`;
    saveSuccess.hidden = false;
    resultsCard.hidden = true;
    fotosInput.value = "";
    atividadeInput.value = "";
    processButton.disabled = true;
  } catch (erro) {
    console.error(erro);
    alert("Erro ao salvar as fotos no Drive. Verifique sua conexão e tente novamente.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Salvar fotos confirmadas";
  }
});
