// ============================================
// PhotoClass - Configuração do Google Drive
// ============================================
// Este arquivo guarda as informações de acesso ao Google Drive
// onde as fotos dos alunos são armazenadas.
//
// Cada segmento tem sua própria pasta raiz (conta de coordenação
// diferente). Dentro dela, o app cria automaticamente, pra cada foto
// enviada: Turma > Aluno > Atividade > foto.jpg
// (ou Turma > "Não identificados" > Atividade > foto.jpg, se pendente)
//
// Dois "modelos" de acesso, por segmento (mantido no código pra caso
// algum segmento novo precise do modelo antigo no futuro - hoje os
// dois já estão no modelo novo):
// - "pasta-comum": pasta normal dentro de "Meu Drive" da coordenação.
//   Cada professora recebe permissão só na pasta da(s) turma(s) dela -
//   ela NÃO vê as turmas de outras professoras. Modelo correto/atual.
// - "drive-compartilhado": Drive Compartilhado (jeito antigo, não
//   usado mais). Nele, dar acesso a alguém é tudo ou nada - vira
//   membro do Drive inteiro, enxergando todas as turmas.

export const DRIVE_CONFIG = {
  apiKey: "AIzaSyDDMk3gl0Zg0mbWR0P2BrM_D50Lb7BAeVU",

  // ID do cliente OAuth (console.cloud.google.com > Google Auth Platform > Clientes)
  oauthClientId: "682723749105-sgprktaoi62apl8bo7r114a3u7q7ae4a.apps.googleusercontent.com",

  // Acesso completo ao Drive (necessário pois as pastas raiz já existiam
  // antes do app, criadas manualmente - com o escopo restrito "drive.file"
  // o app não conseguiria enxergá-las). OK usar esse escopo pois a tela
  // de consentimento OAuth está configurada como "Interno" (só contas
  // @colegioarena.com.br), então não precisa de verificação do Google.
  scope: "https://www.googleapis.com/auth/drive",

  segmentos: {
    anosIniciais: {
      raizId: "13VZ3o5_3F6FYFYhb-x9ikJ9JeKm4xpJ7", // pasta "Fotos Anos Iniciais 2026" (dentro de drive.anosinicias@)
      modelo: "pasta-comum"
    },
    fundamental1: {
      raizId: "1MEHLJuStCYyH5yjqxhg-JCa4Ha80DJjy", // pasta "Fotos Fund.1 2026" (dentro de drive.fundamental1@)
      modelo: "pasta-comum"
    }
  },

  // Usado só se uma turma não tiver segmento reconhecido (não deve
  // acontecer, mas evita quebrar o upload nesse caso)
  pastaRaizId: "13VZ3o5_3F6FYFYhb-x9ikJ9JeKm4xpJ7"
};
