// ============================================
// PhotoClass - Configuração do Firebase
// ============================================
// Este arquivo conecta o app ao projeto Firebase (Auth + Firestore).
// Usamos os SDKs modulares do Firebase via CDN (sem npm/build tools),
// já que o PhotoClass é HTML + CSS + JS puro.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Exporta a config crua também - usada pra criar uma instância
// secundária do Firebase (ex: criar login de professora sem
// deslogar o admin no processo)
export const firebaseConfig = {
  apiKey: "AIzaSyC4jXztW4-MRbWAOa7lb9sHY_L_hr7NZVM",
  authDomain: "photoclass-7b1ba.firebaseapp.com",
  projectId: "photoclass-7b1ba",
  storageBucket: "photoclass-7b1ba.firebasestorage.app",
  messagingSenderId: "682723749105",
  appId: "1:682723749105:web:7f47d463dbc0d0443dcd50"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);

// Exporta os serviços que vamos usar em outros arquivos (auth.js, etc)
export const auth = getAuth(app);
export const db = getFirestore(app);
