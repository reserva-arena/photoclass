// ============================================
// PhotoClass - Controle de Papéis (Admin / Professor)
// ============================================
// Por enquanto, quem é admin é definido por uma lista fixa de e-mails.
// Só essas contas veem o botão de alternar entre visão de Admin e
// visão de Professor - as demais professoras sempre usam a visão
// de Professor, sem opção de alternar.

const ADMIN_EMAILS = [
  "luciano.galdino@colegioarena.com.br"
];

export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(email);
}

export function getModoVisualizacao() {
  return sessionStorage.getItem("pc_modo_visualizacao") || "admin";
}

export function setModoVisualizacao(modo) {
  sessionStorage.setItem("pc_modo_visualizacao", modo);
}

// Retorna true só se a conta é admin E está com a visão de Admin ativa
export function estaEmModoAdmin(email) {
  return isAdminEmail(email) && getModoVisualizacao() === "admin";
}

// Configura o botão de alternância no header, se a conta for admin
export function configurarAlternadorVisao(email) {
  const botao = document.getElementById("view-toggle");
  if (!botao) return;

  if (!isAdminEmail(email)) {
    botao.hidden = true;
    return;
  }

  botao.hidden = false;
  atualizarTextoBotao(botao);

  botao.addEventListener("click", () => {
    const modoAtual = getModoVisualizacao();
    const novoModo = modoAtual === "admin" ? "professor" : "admin";
    setModoVisualizacao(novoModo);
    window.location.reload();
  });
}

function atualizarTextoBotao(botao) {
  const modo = getModoVisualizacao();
  botao.textContent = modo === "admin" ? "👤 Ver como Professor" : "🛠 Ver como Admin";
}
