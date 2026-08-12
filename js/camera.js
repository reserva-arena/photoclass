// ============================================
// PhotoClass - Captura pela câmera
// ============================================
// Componente reutilizável: abre a câmera do celular numa tela cheia,
// permite tirar várias fotos seguidas (sem sair do app a cada foto,
// como um app de scanner), com miniaturas pra conferir/descartar antes
// de confirmar. Usado tanto em Fotos quanto em Registros do Aluno.
//
// Uso:
//   import { abrirCapturaCamera } from "./camera.js";
//   const arquivos = await abrirCapturaCamera(); // File[] (vazio se cancelar)

export function abrirCapturaCamera() {
  return new Promise((resolve) => {
    const capturas = []; // { blob, url }
    let stream = null;

    const overlay = document.createElement("div");
    overlay.className = "camera-overlay";
    overlay.innerHTML = `
      <div class="camera-topo">
        <span id="camera-contador">0 foto(s)</span>
        <button type="button" id="camera-fechar" class="camera-botao-fechar" aria-label="Fechar">✕</button>
      </div>
      <div class="camera-video-wrap">
        <video id="camera-video" autoplay playsinline muted></video>
        <p id="camera-erro" class="camera-erro" hidden></p>
      </div>
      <div id="camera-miniaturas" class="camera-miniaturas"></div>
      <div class="camera-controles">
        <button type="button" id="camera-cancelar" class="btn-ghost camera-botao-claro">Cancelar</button>
        <button type="button" id="camera-capturar" class="camera-botao-capturar" aria-label="Tirar foto"></button>
        <button type="button" id="camera-concluir" class="btn-primary" disabled>Usar (0)</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    const video = overlay.querySelector("#camera-video");
    const erroEl = overlay.querySelector("#camera-erro");
    const contadorEl = overlay.querySelector("#camera-contador");
    const miniaturasEl = overlay.querySelector("#camera-miniaturas");
    const botaoCapturar = overlay.querySelector("#camera-capturar");
    const botaoConcluir = overlay.querySelector("#camera-concluir");
    const botaoCancelar = overlay.querySelector("#camera-cancelar");
    const botaoFechar = overlay.querySelector("#camera-fechar");

    function encerrar(resultado) {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      capturas.forEach((c) => URL.revokeObjectURL(c.url));
      document.body.style.overflow = "";
      overlay.remove();
      resolve(resultado);
    }

    function atualizarContadores() {
      contadorEl.textContent = `${capturas.length} foto(s)`;
      botaoConcluir.textContent = `Usar (${capturas.length})`;
      botaoConcluir.disabled = capturas.length === 0;
    }

    function renderizarMiniaturas() {
      miniaturasEl.innerHTML = capturas.map((c, i) => `
        <div class="camera-miniatura">
          <img src="${c.url}" alt="Foto ${i + 1}">
          <button type="button" class="camera-miniatura-remover" data-indice="${i}" aria-label="Remover">✕</button>
        </div>
      `).join("");

      miniaturasEl.querySelectorAll(".camera-miniatura-remover").forEach((botao) => {
        botao.addEventListener("click", () => {
          const indice = Number(botao.getAttribute("data-indice"));
          URL.revokeObjectURL(capturas[indice].url);
          capturas.splice(indice, 1);
          renderizarMiniaturas();
          atualizarContadores();
        });
      });
    }

    botaoCapturar.addEventListener("click", () => {
      if (!stream) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        capturas.push({ blob, url: URL.createObjectURL(blob) });
        renderizarMiniaturas();
        atualizarContadores();
        // pisca a tela pra dar feedback de "clique"
        overlay.classList.add("camera-flash");
        setTimeout(() => overlay.classList.remove("camera-flash"), 120);
      }, "image/jpeg", 0.9);
    });

    botaoConcluir.addEventListener("click", () => {
      const arquivos = capturas.map((c, i) => new File([c.blob], `camera_${Date.now()}_${i}.jpg`, { type: "image/jpeg" }));
      encerrar(arquivos);
    });

    botaoCancelar.addEventListener("click", () => encerrar([]));
    botaoFechar.addEventListener("click", () => encerrar([]));

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        video.srcObject = stream;
      })
      .catch((erro) => {
        console.error("Erro ao abrir a câmera:", erro);
        erroEl.textContent = "Não foi possível abrir a câmera. Verifique se o navegador tem permissão de acesso à câmera (nas configurações do celular) e tente de novo.";
        erroEl.hidden = false;
        botaoCapturar.disabled = true;
      });
  });
}
