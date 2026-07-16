// ============================================
// PhotoClass - Configuração do Google Drive
// ============================================
// Este arquivo guarda as informações de acesso ao Google Drive
// onde as fotos dos alunos são armazenadas.
//
// IMPORTANTE: cada segmento da escola usa uma conta de Drive separada
// (isolamento de acesso). Por enquanto, só temos o segmento
// "Educação Infantil" configurado.

export const DRIVE_CONFIG = {
  apiKey: "AIzaSyDDMk3gl0Zg0mbWR0P2BrM_D50Lb7BAeVU",

  // Pastas por segmento (vamos expandir isso conforme novos segmentos entrarem)
  segments: {
    anosIniciais: {
      nome: "Educação Infantil",
      contaDrive: "drive.anosinicias@colegioarena.com.br",
      pastaId: "13VZ3o5_3F6FYFYhb-x9ikJ9JeKm4xpJ7"
    }
    // fundamental1: { ... } -> adicionar quando expandirmos
  }
};
