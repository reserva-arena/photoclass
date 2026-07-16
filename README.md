# PhotoClass

App de organização de fotos por reconhecimento facial, desenvolvido para uso escolar.

## O que faz

Professores cadastram alunos com uma foto de referência. Ao longo do ano, fazem upload de fotos das atividades, e o app organiza automaticamente cada foto na pasta do aluno correto, usando reconhecimento facial. Pais recebem um link para acessar as fotos do próprio filho.

## Stack

- **Frontend:** HTML, CSS e JavaScript puro (sem frameworks)
- **Autenticação e banco de dados:** Firebase (Authentication + Firestore)
- **Armazenamento de fotos:** Google Drive (via Google Workspace)
- **Reconhecimento facial:** TensorFlow.js (fase inicial gratuita)
- **Hospedagem:** Firebase Hosting
- **Versionamento:** GitHub

## Estrutura do projeto

```
photoclass/
├── index.html              → tela de login
├── dashboard.html          → área do professor (em construção)
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js  → conexão com Firebase
│   ├── auth.js              → lógica de login/logout
│   └── drive-config.js      → conexão com Google Drive API
└── assets/
```

## Segmentos atendidos

Cada segmento da escola usa uma conta de Google Drive separada, garantindo isolamento total de acesso entre professores de diferentes turmas.

- ✅ Educação Infantil (em desenvolvimento)
- ⏳ Fundamental 1 (planejado para expansão futura)

## Status

Projeto em fase inicial de desenvolvimento. Estrutura e configurações de backend concluídas; interface e lógica de negócio em construção.
