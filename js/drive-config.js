// ============================================
// PhotoClass - Configuração do Google Drive
// ============================================
// Este arquivo guarda as informações de acesso ao Google Drive
// onde as fotos dos alunos são armazenadas.
//
// Estrutura: um Drive Compartilhado por segmento (cada coordenação
// cuida do seu). Dentro de cada um, o app cria automaticamente, pra
// cada foto enviada: Turma > Aluno > Atividade > foto.jpg
// (ou Turma > "Não identificados" > Atividade > foto.jpg, se pendente)

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

  // Um Drive Compartilhado por segmento - cada coordenação tem o seu
  pastasRaizPorSegmento: {
    anosIniciais: "0AICRXWG8AsvPUk9PVA", // Drive "Fotos alunos" (Educação Infantil)
    fundamental1: "0AGpsKU-WmOM5Uk9PVA" // Drive "Fotos Ativ. Fund.1 - 2026"
  },

  // Usado só se uma turma não tiver segmento reconhecido (não deve
  // acontecer, mas evita quebrar o upload nesse caso)
  pastaRaizId: "0AICRXWG8AsvPUk9PVA"
};
