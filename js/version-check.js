// ============================================
// PhotoClass - Aviso de nova versão disponível
// ============================================
// IMPORTANTE pra manutenção: esse arquivo (version-check.js) TEM
// cache-busting na tag <script> dos HTMLs (?v=...) - se editar este
// arquivo, lembre de atualizar esse ?v= em todos os HTMLs que o
// referenciam, senão a mudança fica presa em cache no navegador de quem
// já usou o app antes.
// Compara periodicamente o version.json publicado no servidor com o que
// estava lá quando a página foi carregada. Se mudou, é sinal de que uma
// atualização foi publicada enquanto a pessoa usava o app com a aba
// aberta - mostra um aviso no meio da tela oferecendo recarregar.
//
// IMPORTANTE pra manutenção: isso só funciona se version.json for
// atualizado a cada deploy (mudar o valor de "versao" pra algo novo,
// ex: a data de hoje). Esse arquivo (version-check.js) não precisa de
// cache-busting nem de ser tocado a cada deploy - só o version.json.

const INTERVALO_VERIFICACAO_MS = 3 * 60 * 1000; // a cada 3 minutos

let versaoCarregada = null;

async function buscarVersaoAtual() {
  try {
    const resposta = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!resposta.ok) return null;
    const dados = await resposta.json();
    return dados.versao || null;
  } catch {
    // Sem internet no momento, ou o arquivo não existe ainda - ignora
    // silenciosamente, tenta de novo na próxima verificação
    return null;
  }
}

function mostrarAvisoAtualizacao() {
  if (document.getElementById("aviso-nova-versao")) return; // já mostrando, não duplica

  const overlay = document.createElement("div");
  overlay.id = "aviso-nova-versao";
  overlay.className = "aviso-nova-versao-overlay";
  overlay.innerHTML = `
    <div class="aviso-nova-versao-card">
      <div class="aviso-nova-versao-icone">🔄</div>
      <h2>Nova atualização disponível</h2>
      <p class="card-subtitle">O PhotoClass foi atualizado com melhorias e correções. Atualize a página pra usar a versão mais recente.</p>
      <div class="aviso-nova-versao-botoes">
        <button type="button" id="aviso-nova-versao-agora" class="btn-primary">Atualizar agora</button>
        <button type="button" id="aviso-nova-versao-depois" class="btn-ghost">Lembrar depois</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#aviso-nova-versao-agora").addEventListener("click", () => {
    // Um reload() comum às vezes ainda usa arquivos guardados em cache
    // pelo navegador. Trocando a URL pra uma nunca vista antes (com um
    // parâmetro novo), o navegador é obrigado a buscar tudo de novo no
    // servidor, sem chance de pegar versão antiga do cache.
    const urlSemParametrosAntigos = window.location.origin + window.location.pathname;
    window.location.href = `${urlSemParametrosAntigos}?_atualizado=${Date.now()}`;
  });
  overlay.querySelector("#aviso-nova-versao-depois").addEventListener("click", () => {
    overlay.remove();
    // Não pergunta de novo nos próximos 10 minutos, pra não incomodar
    // repetidamente enquanto a pessoa está no meio de uma tarefa
    versaoCarregada = null;
    setTimeout(verificarAtualizacao, 10 * 60 * 1000);
  });
}

async function verificarAtualizacao() {
  const versaoServidor = await buscarVersaoAtual();
  if (!versaoServidor) return;

  if (versaoCarregada === null) {
    versaoCarregada = versaoServidor;
    return;
  }

  if (versaoServidor !== versaoCarregada) {
    mostrarAvisoAtualizacao();
  }
}

// Primeira checagem define a "versão da sessão"; verificações seguintes
// comparam contra essa referência
verificarAtualizacao();
setInterval(verificarAtualizacao, INTERVALO_VERIFICACAO_MS);

// Também checa quando a pessoa volta pra aba depois de um tempo fora
// (troca de app no celular, outra aba do navegador, etc.) - é o momento
// mais comum de estar usando uma versão desatualizada sem saber
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") verificarAtualizacao();
});
