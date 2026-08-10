// ============================================
// PhotoClass - Lista de Turmas
// ============================================
// Lista oficial usada no cadastro de alunos, evitando erro de
// digitação (texto livre) e mantendo o nome padronizado das turmas.
//
// Se precisar adicionar/remover uma turma, é só editar essa lista.

export const TURMAS = [
  // Educação Infantil (Anos Iniciais)
  { nome: "Inf. 2A Mat", segmento: "anosIniciais" },
  { nome: "Inf. 2B Mat", segmento: "anosIniciais" },
  { nome: "Inf. 3A Mat", segmento: "anosIniciais" },
  { nome: "Inf. 3B Mat", segmento: "anosIniciais" },
  { nome: "Inf. 4A Mat", segmento: "anosIniciais" },
  { nome: "Inf. 4B Mat", segmento: "anosIniciais" },
  { nome: "Inf. 5A Mat", segmento: "anosIniciais" },
  { nome: "Inf. 5B Mat", segmento: "anosIniciais" },
  { nome: "Inf. 5C Mat", segmento: "anosIniciais" },
  { nome: "Inf. 1A Vesp", segmento: "anosIniciais" },
  { nome: "Inf. 2A Vesp", segmento: "anosIniciais" },
  { nome: "Inf. 3A Vesp", segmento: "anosIniciais" },
  { nome: "Inf. 4A Vesp", segmento: "anosIniciais" },
  { nome: "Inf. 4B Vesp", segmento: "anosIniciais" },
  { nome: "Inf. 5A Vesp", segmento: "anosIniciais" },

  // Fundamental 1
  { nome: "1º Ano A", segmento: "fundamental1" },
  { nome: "1º Ano B", segmento: "fundamental1" },
  { nome: "1º Ano C", segmento: "fundamental1" },
  { nome: "2º Ano A", segmento: "fundamental1" },
  { nome: "2º Ano B", segmento: "fundamental1" },
  { nome: "2º Ano C", segmento: "fundamental1" },
  { nome: "3º Ano A", segmento: "fundamental1" },
  { nome: "3º Ano B", segmento: "fundamental1" },
  { nome: "3º Ano C", segmento: "fundamental1" },
  { nome: "4º Ano A", segmento: "fundamental1" },
  { nome: "4º Ano B", segmento: "fundamental1" },
  { nome: "4º Ano C", segmento: "fundamental1" },
  { nome: "4º Ano D", segmento: "fundamental1" },
  { nome: "5º Ano A", segmento: "fundamental1" },
  { nome: "5º Ano B", segmento: "fundamental1" },
  { nome: "5º Ano C", segmento: "fundamental1" },
  { nome: "5º Ano D", segmento: "fundamental1" },
  { nome: "5º Ano E", segmento: "fundamental1" },

  // Integral (período estendido) - turmas separadas das regulares
  { nome: "Integral 1º Ano", segmento: "fundamental1" },
  { nome: "Integral 2º e 3º Ano", segmento: "fundamental1" },
  { nome: "Integral 4º e 5º Ano", segmento: "fundamental1" }
];

export const NOMES_SEGMENTO = {
  anosIniciais: "Educação Infantil",
  fundamental1: "Fundamental 1"
};
