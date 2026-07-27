// ============================================
// PhotoClass - Configuração do Google Drive
// ============================================
// Este arquivo guarda as informações de acesso ao Google Drive
// onde as fotos dos alunos são armazenadas.
//
// Estrutura atual: um único Drive Compartilhado (organização, não
// professora), com uma pasta raiz onde o app cria automaticamente,
// pra cada foto enviada: Turma > Aluno > foto.jpg
// (ou Turma > "Não identificados" > foto.jpg, enquanto pendente)

export const DRIVE_CONFIG = {
  apiKey: "AIzaSyDDMk3gl0Zg0mbWR0P2BrM_D50Lb7BAeVU",

  // ID do cliente OAuth (console.cloud.google.com > Google Auth Platform > Clientes)
  oauthClientId: "682723749105-sgprktaoi62apl8bo7r114a3u7q7ae4a.apps.googleusercontent.com",

  // Acesso completo ao Drive (necessário pois a pasta raiz já existia
  // antes do app, criada manualmente - com o escopo restrito "drive.file"
  // o app não conseguiria enxergá-la). OK usar esse escopo pois a tela
  // de consentimento OAuth está configurada como "Interno" (só contas
  // @colegioarena.com.br), então não precisa de verificação do Google.
  scope: "https://www.googleapis.com/auth/drive",

  // Pasta "Fotos alunos" dentro do Drive Compartilhado - tudo é
  // organizado automaticamente a partir daqui
  pastaRaizId: "0AICRXWG8AsvPUk9PVA",

  // Mantido por enquanto para referência do segmento antigo (Educação
  // Infantil) - pode ser removido quando tudo migrar pro Drive
  // Compartilhado único acima
  segments: {
    anosIniciais: {
      nome: "Educação Infantil",
      contaDrive: "drive.anosinicias@colegioarena.com.br",
      pastaId: "13VZ3o5_3F6FYFYhb-x9ikJ9JeKm4xpJ7"
    }
  }
};
