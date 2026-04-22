// Renders a share widget (QR code + copy link) into a container element.
// Requires the QRCode global from: https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js
export function initShareWidget(containerId) {
  const url = window.location.href;
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="share-widget">
      <button class="share-toggle" title="Invite players">📲 Invite</button>
      <div class="share-panel hidden">
        <div id="share-qr"></div>
        <p class="share-url">${url}</p>
        <button class="copy-link-btn">Copy Link</button>
      </div>
    </div>
  `;

  const toggle = container.querySelector('.share-toggle');
  const panel = container.querySelector('.share-panel');
  const copyBtn = container.querySelector('.copy-link-btn');
  let qrRendered = false;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden') && !qrRendered) {
      new QRCode(document.getElementById('share-qr'), {
        text: url,
        width: 160,
        height: 160,
        colorDark: '#212121',
        colorLight: '#ffffff',
      });
      qrRendered = true;
    }
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) panel.classList.add('hidden');
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
    } catch {
      copyBtn.textContent = url;
    }
  });
}
