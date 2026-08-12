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

import { DRIVE_CONFIG } from "./drive-config.js?v=20260812g";
import { TURMAS } from "./turmas.js?v=20260812g";

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

// Cada segmento (Educação Infantil, Fundamental 1...) tem sua própria
// pasta raiz - essa função descobre qual usar a partir do nome da turma
export function obterPastaRaizDaTurma(turma) {
  const info = TURMAS.find((t) => t.nome === turma);
  const segmento = info?.segmento;
  return DRIVE_CONFIG.segmentos?.[segmento]?.raizId || DRIVE_CONFIG.pastaRaizId;
}

// "pasta-comum" (modelo novo, correto) ou "drive-compartilhado" (modelo
// antigo, em transição) - ver explicação em drive-config.js
export function obterModeloDaTurma(turma) {
  const info = TURMAS.find((t) => t.nome === turma);
  const segmento = info?.segmento;
  return DRIVE_CONFIG.segmentos?.[segmento]?.modelo || "drive-compartilhado";
}

// Monta (ou reaproveita) a pasta de destino de uma foto:
// Raiz > Turma > Aluno > Atividade, ou
// Raiz > Turma > "Não identificados" > Atividade
// quando ainda não sabemos de qual aluno é a foto.
export async function obterPastaDestino({ turma, alunoNome, pendente, atividade }, accessToken) {
  const pastaTurma = await obterOuCriarPasta(turma, obterPastaRaizDaTurma(turma), accessToken);

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

// Compartilha uma pasta com o e-mail específico de alguém (mais seguro
// que "qualquer pessoa com o link" - só quem estiver logado com essa
// conta Google consegue acessar). O Google manda um e-mail de convite
// automático pra essa pessoa.
export async function compartilharComEmail(pastaId, email, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${pastaId}/permissions?supportsAllDrives=true&sendNotificationEmail=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: "reader", type: "user", emailAddress: email })
    }
  );
  if (!resposta.ok) throw new Error(`Erro ao compartilhar com ${email}: ${await mensagemDeErroGoogle(resposta)}`);
  return resposta.json();
}

// Lista quem já tem acesso direto (por e-mail, não "qualquer um com o
// link") a uma pasta
export async function listarAcessosPorEmail(pastaId, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${pastaId}/permissions?supportsAllDrives=true&fields=permissions(id,type,role,emailAddress)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resposta.ok) throw new Error(`Erro ao listar acessos: ${await mensagemDeErroGoogle(resposta)}`);
  const dados = await resposta.json();
  return (dados.permissions || []).filter((p) => p.type === "user" && p.role === "reader");
}

// Exclui uma pasta inteira do Drive (e tudo que tem dentro dela) -
// usado pra limpar uma turma de teste de uma vez
export async function excluirPasta(pastaId, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${pastaId}?supportsAllDrives=true`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resposta.ok && resposta.status !== 404) {
    throw new Error(`Erro ao excluir a pasta no Drive: ${await mensagemDeErroGoogle(resposta)}`);
  }
}

// Dá acesso de Editor a alguém em UMA PASTA ESPECÍFICA (modelo novo,
// "pasta-comum") - diferente do Drive Compartilhado, aqui a pessoa só
// enxerga essa pasta (e o que tem dentro dela), nada mais na conta.
// É assim que uma professora só vê a(s) turma(s) dela, não a escola toda.
export async function concederAcessoEditorPasta(pastaId, email, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${pastaId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: "writer", type: "user", emailAddress: email })
    }
  );
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => null);
    if (dados?.error?.message?.toLowerCase().includes("already")) return;
    throw new Error(`Erro ao dar acesso à pasta: ${dados?.error?.message || resposta.status}`);
  }
}

// Adiciona alguém como membro de um Drive Compartilhado (não uma
// pasta comum) - necessário pra professora conseguir subir fotos por
// lá, além do acesso ao próprio app. "fileOrganizer" = Gerenciador de
// conteúdo (o papel certo pra criar/editar arquivos, mas sem poder
// excluir o Drive Compartilhado em si nem mexer nos membros).
// ATENÇÃO: dá acesso ao Drive INTEIRO (todas as turmas dele), não só
// uma - é o modelo antigo, mantido só até migrarmos esse segmento
// pro modelo de pasta comum (ver drive-config.js).
export async function adicionarMembroDriveCompartilhado(driveId, email, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: "fileOrganizer", type: "user", emailAddress: email })
    }
  );
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => null);
    // Já é membro? Não é um erro de verdade, apenas ignora
    if (dados?.error?.message?.toLowerCase().includes("already")) return;
    throw new Error(`Erro ao dar acesso ao Drive Compartilhado: ${dados?.error?.message || resposta.status}`);
  }
}

// ---------- Compartilhamento (link pros pais) ----------

// Compartilha uma pasta como "Leitor" pra qualquer pessoa com o link -
// dá pra ver e baixar, mas NÃO aparece nenhuma opção de excluir/mover/
// editar (Leitor no Drive é sempre somente-leitura). Retorna a URL
// pronta pra copiar e enviar.
export async function compartilharPasta(pastaId, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${pastaId}/permissions?supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: "reader", type: "anyone" })
    }
  );
  if (!resposta.ok) throw new Error(`Erro ao compartilhar a pasta: ${await mensagemDeErroGoogle(resposta)}`);
  return `https://drive.google.com/drive/folders/${pastaId}`;
}

// Verifica se a pasta já está compartilhada por link (pra mostrar o
// link certo sem precisar gerar de novo toda vez que abrir a tela)
export async function verificarCompartilhamento(pastaId, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${pastaId}/permissions?supportsAllDrives=true&fields=permissions(id,type,role)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resposta.ok) throw new Error(`Erro ao verificar compartilhamento: ${await mensagemDeErroGoogle(resposta)}`);
  const dados = await resposta.json();
  const permissaoPublica = (dados.permissions || []).find((p) => p.type === "anyone");
  return permissaoPublica ? { id: permissaoPublica.id, link: `https://drive.google.com/drive/folders/${pastaId}` } : null;
}

// Remove o acesso público (o link para de funcionar pra quem não tem
// acesso normal à pasta)
export async function removerCompartilhamento(pastaId, permissaoId, accessToken) {
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${pastaId}/permissions/${permissaoId}?supportsAllDrives=true`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resposta.ok && resposta.status !== 404) {
    throw new Error(`Erro ao remover o compartilhamento: ${await mensagemDeErroGoogle(resposta)}`);
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
