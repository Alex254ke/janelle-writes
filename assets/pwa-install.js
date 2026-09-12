(() => {
  const INSTALL_SELECTOR = '[data-pwa-install]';
  let installPrompt = null;

  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const canOfferInstall = () => !isStandalone() && (Boolean(installPrompt) || isIos());

  function installButtons() {
    return Array.from(document.querySelectorAll(INSTALL_SELECTOR));
  }

  function syncInstallButtons() {
    const visible = canOfferInstall();
    installButtons().forEach(button => {
      button.hidden = !visible;
      button.setAttribute('aria-hidden', String(!visible));
    });
    ensureDashboardInstallButton(visible);
  }

  function ensureDashboardInstallButton(visible) {
    const nav = document.getElementById('sidebar-nav');
    let button = document.getElementById('jw-pwa-install-nav');
    if (!visible) {
      if (button) button.hidden = true;
      return;
    }
    if (!nav) return;
    if (!button) {
      button = document.createElement('button');
      button.id = 'jw-pwa-install-nav';
      button.type = 'button';
      button.className = 'nav-item pwa-install-nav';
      button.setAttribute('data-pwa-install', '');
      button.innerHTML = '<span class="icon"><i class="bi bi-phone" aria-hidden="true"></i></span> Install App';
      nav.appendChild(button);
    }
    button.hidden = false;
    button.setAttribute('aria-hidden', 'false');
  }

  function closeInstructions() {
    document.getElementById('jw-install-help')?.remove();
  }

  function showIosInstructions() {
    closeInstructions();
    const dialog = document.createElement('div');
    dialog.id = 'jw-install-help';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'jw-install-help-title');
    dialog.innerHTML = `
      <div class="jw-install-help-backdrop" data-install-close></div>
      <div class="jw-install-help-card">
        <button class="jw-install-help-close" type="button" data-install-close aria-label="Close">&times;</button>
        <span class="jw-install-help-mark" aria-hidden="true">J</span>
        <h2 id="jw-install-help-title">Add Janelle Writes to your Home Screen</h2>
        <ol>
          <li>Open this page in Safari.</li>
          <li>Tap the Share button in the browser toolbar.</li>
          <li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li>
        </ol>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.jw-install-help-close')?.focus();
  }

  async function requestInstall() {
    if (isStandalone()) return;
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      syncInstallButtons();
      return;
    }
    if (isIos()) showIosInstructions();
  }

  document.addEventListener('click', event => {
    if (event.target.closest(INSTALL_SELECTOR)) {
      event.preventDefault();
      requestInstall().catch(() => {});
      return;
    }
    if (event.target.closest('[data-install-close]')) closeInstructions();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeInstructions();
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    syncInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    closeInstructions();
    syncInstallButtons();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }, { once: true });
  }

  const installStyles = document.createElement('style');
  installStyles.textContent = `
    #jw-install-help{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px}
    .jw-install-help-backdrop{position:absolute;inset:0;background:rgba(7,20,28,.72);backdrop-filter:blur(8px)}
    .jw-install-help-card{position:relative;width:min(440px,100%);padding:32px;border:1px solid #cfe4e0;border-radius:24px;color:#102633;background:#fff;box-shadow:0 30px 90px rgba(7,20,28,.32);font-family:'DM Sans',Arial,sans-serif}
    .jw-install-help-card h2{margin:18px 0 14px;font-family:'Playfair Display',Georgia,serif;font-size:28px;line-height:1.12}
    .jw-install-help-card ol{margin:0;padding-left:22px;color:#4f6872;line-height:1.65}
    .jw-install-help-card li+li{margin-top:8px}
    .jw-install-help-mark{width:54px;height:54px;display:grid;place-items:center;border-radius:16px;color:#fff;background:linear-gradient(145deg,#102633,#174454);font:34px Georgia,serif}
    .jw-install-help-close{position:absolute;top:16px;right:16px;width:38px;height:38px;border:0;border-radius:12px;color:#102633;background:#edf6f4;font-size:25px;cursor:pointer}
  `;
  document.head.appendChild(installStyles);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncInstallButtons, { once: true });
  } else {
    syncInstallButtons();
  }

  new MutationObserver(() => syncInstallButtons()).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
