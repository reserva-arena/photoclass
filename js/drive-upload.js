// ============================================
// PhotoClass - Integração com Google Drive
// ============================================
// Faz o upload real das fotos para o Drive Compartilhado, criando
// automaticamente a estrutura de pastas: Turma > Aluno > foto.jpg
// (ou Turma > "Não identificados" > foto.jpg, enquanto pendente).
//
// Usa Google Identity Services (GIS) para pedir autorização OAuth
// à professora logada - a janela de consentimento do Google aparece
// só na primeira vez (ou quando o token expira, ~1h).

import { DRIVE_CONFIG } from "./drive-config.js?v=20260727c";

const PASTA_MIME = "application/vnd.google-apps.folder";

// Extrai a mensagem de erro de verdade que o Google devolveu,
// pra mostrar algo útil na tela (não só "deu erro")
async function mensagemDeErroGoogle(resposta) {
  try {
    const dados = await resposta.json();
    return dados?.error?.message || `Erro ${resposta.status}`;
  } catch {
    return `Erro ${resposta.status}`;
  }
}
const NOME_PASTA_PENDENTES = "Não identificados";

let tokenClient = null;
let tokenAtual = null; // { access_token, expiraEm }
let resolverPendente = null;
let emailUsuario = null; // e-mail já logado no PhotoClass, evita o Google perguntar "qual conta usar?"

// Chama isso assim que souber o e-mail da professora logada (Firebase
// Auth), pra evitar a tela de "Escolha uma conta" quando ela tem mais
// de uma conta Google logada no navegador
export function definirEmailUsuario(email) {
  emailUsuario = email;
}

// Cache em memória das pastas já localizadas/criadas nesta sessão,
// pra não repetir a mesma busca no Drive várias vezes seguidas
const cachePastas = new Map(); // chave: "paiId::nome" -> pastaId

// ---------- Autorização (OAuth) ----------

function garantirTokenClient() {
  if (tokenClient) return tokenClient;

  if (!window.google || !window.google.accounts) {
    throw new Error("Google Identity Services ainda não carregou. Recarregue a página.");
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CONFIG.oauthClientId,
    scope: DRIVE_CONFIG.scope,
    hint: emailUsuario || undefined,
    callback: (resposta) => {
      if (resposta.error) {
        if (resolverPendente) resolverPendente.reject(resposta);
        resolverPendente = null;
        return;
      }
      tokenAtual = {
        access_token: resposta.access_token,
        // margem de 1 minuto de segurança antes do vencimento real
        expiraEm: Date.now() + (Number(resposta.expires_in) - 60) * 1000
      };
      if (resolverPendente) resolverPendente.resolve(tokenAtual.access_token);
      resolverPendente = null;
    }
  });

  return tokenClient;
}

// Retorna um access token válido pro Drive. Pede consentimento à
// professora automaticamente quando necessário (primeira vez de
// verdade, ou se o acesso foi revogado) - caso contrário, renova
// o token em silêncio, sem mostrar nenhuma tela pro Google.
export async function garantirTokenAcesso() {
  if (tokenAtual && Date.now() < tokenAtual.expiraEm) {
    return tokenAtual.access_token;
  }

  try {
    // Tenta primeiro sem mostrar nada (funciona se ela já autorizou
    // o PhotoClass antes nesse navegador, mesmo que a página tenha
    // recarregado ou seja outra aba)
    return await solicitarToken("");
  } catch {
    // Só cai aqui se realmente não tiver autorização válida ainda
    return await solicitarToken("consent");
  }
}

function solicitarToken(prompt) {
  return new Promise((resolve, reject) => {
    resolverPendente = { resolve, reject };
    const client = garantirTokenClient();
    client.requestAccessToken({ prompt });
  });
}

// ---------- Pastas (buscar ou criar) ----------

async function buscarPasta(nome, paiId, accessToken) {
  const nomeEscapado = nome.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `name='${nomeEscapado}' and '${paiId}' in parents and mimeType='${PASTA_MIME}' and trashed=false`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&fields=files(id,name)`;

  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resposta.ok) throw new Error(`Erro ao buscar a pasta "${nome}" no Drive: ${await mensagemDeErroGoogle(resposta)}`);
  const dados = await resposta.json();
  return dados.files && dados.files.length > 0 ? dados.files[0].id : null;
}

async function criarPasta(nome, paiId, accessToken) {
  const resposta = await fetch(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: nome,
        mimeType: PASTA_MIME,
        parents: [paiId]
      })
    }
  );
  if (!resposta.ok) throw new Error(`Erro ao criar a pasta "${nome}" no Drive: ${await mensagemDeErroGoogle(resposta)}`);
  const dados = await resposta.json();
  return dados.id;
}

// Busca a pasta "nome" dentro de "paiId"; cria automaticamente se
// ainda não existir. Usa cache em memória na mesma sessão.
export async function obterOuCriarPasta(nome, paiId, accessToken) {
  const chave = `${paiId}::${nome}`;
  if (cachePastas.has(chave)) return cachePastas.get(chave);

  let pastaId = await buscarPasta(nome, paiId, accessToken);
  if (!pastaId) {
    pastaId = await criarPasta(nome, paiId, accessToken);
  }

  cachePastas.set(chave, pastaId);
  return pastaId;
}

// Monta (ou reaproveita) a pasta de destino de uma foto:
// Raiz > Turma > Aluno > Atividade, ou
// Raiz > Turma > "Não identificados" > Atividade
// quando ainda não sabemos de qual aluno é a foto.
export async function obterPastaDestino({ turma, alunoNome, pendente, atividade }, accessToken) {
  const pastaTurma = await obterOuCriarPasta(turma, DRIVE_CONFIG.pastaRaizId, accessToken);

  const pastaAlunoOuPendentes =
    pendente || !alunoNome
      ? await obterOuCriarPasta(NOME_PASTA_PENDENTES, pastaTurma, accessToken)
      : await obterOuCriarPasta(alunoNome, pastaTurma, accessToken);

  if (!atividade) return pastaAlunoOuPendentes;
  return obterOuCriarPasta(atividade, pastaAlunoOuPendentes, accessToken);
}

// ---------- Upload / mover / excluir arquivos ----------

// Envia um arquivo pro Drive, dentro da pasta indicada.
// Retorna { id, webViewLink }.
export async function enviarArquivo(blob, nomeArquivo, pastaId, accessToken) {
  const metadados = { name: nomeArquivo, parents: [pastaId] };
  const boundary = "photoclass-" + Math.random().toString(36).slice(2);

  const corpo = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadados)}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`
  ]);

  const resposta = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: corpo
    }
  );

  if (!resposta.ok) {
    throw new Error(`Erro ao enviar "${nomeArquivo}" pro Drive: ${await mensagemDeErroGoogle(resposta)}`);
  }

  return resposta.json();
}

// Cria uma CÓPIA de um arquivo já existente numa pasta diferente
// (usado quando uma foto tem mais de um aluno - já que num Drive
// Compartilhado um arquivo só pode ter uma pasta-mãe, então pra
// aparecer em mais de uma pasta de aluno é preciso duplicar)
export async function copiarArquivo(fileId, novaPastaId, novoNome, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: novoNome, parents: [novaPastaId] })
    }
  );
  if (!resposta.ok) throw new Error(`Erro ao copiar o arquivo no Drive: ${await mensagemDeErroGoogle(resposta)}`);
  return resposta.json();
}

// Move um arquivo de uma pasta pra outra (usado na tela de Revisão,
// quando uma foto pendente é finalmente identificada)
export async function moverArquivo(fileId, pastaOrigemId, pastaDestinoId, accessToken) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${fileId}` +
    `?addParents=${pastaDestinoId}&removeParents=${pastaOrigemId}&supportsAllDrives=true&fields=id,parents`;

  const resposta = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resposta.ok) throw new Error(`Erro ao mover o arquivo no Drive: ${await mensagemDeErroGoogle(resposta)}`);
  return resposta.json();
}

// Exclui um arquivo do Drive (usado ao descartar uma foto pendente)
export async function excluirArquivo(fileId, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  // 404 = arquivo já não existe mais, pode ignorar
  if (!resposta.ok && resposta.status !== 404) {
    throw new Error(`Erro ao excluir o arquivo no Drive: ${await mensagemDeErroGoogle(resposta)}`);
  }
}

// ---------- Utilitários de imagem ----------

// Converte um data URL (base64) em Blob
export function dataUrlParaBlob(dataUrl) {
  const [cabecalho, base64] = dataUrl.split(",");
  const mime = cabecalho.match(/:(.*?);/)[1];
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
