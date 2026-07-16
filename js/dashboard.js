// ============================================
// PhotoClass - Painel do Professor
// ============================================
// Por enquanto só protege a página e permite logout.
// A funcionalidade real (cadastro de alunos, upload de
// fotos) será construída nas próximas etapas.

import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const userEmailLabel = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

// Se não estiver logado, manda de volta pro login
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    userEmailLabel.textContent = user.email;
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});
