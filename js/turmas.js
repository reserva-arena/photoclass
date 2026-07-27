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

  // Fundamental 1 (1º ano)
  { nome: "1ºA", segmento: "fundamental1" },
  { nome: "1ºB", segmento: "fundamental1" },
  { nome: "1ºC", segmento: "fundamental1" },
  { nome: "1ºD", segmento: "fundamental1" },
  { nome: "1ºE", segmento: "fundamental1" }
];

export const NOMES_SEGMENTO = {
  anosIniciais: "Educação Infantil",
  fundamental1: "Fundamental 1"
};
