(() => {
  const script = document.currentScript;
  const origin = new URL(script.src).origin;
  const store = script.dataset.store || document.title;

  const style = document.createElement('style');
  style.textContent = `
    .tz-launcher { position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; display: flex; align-items: center; gap: 10px;
      padding: 14px 20px 14px 16px; border: 0; border-radius: 999px; background: #000; color: #fff; cursor: pointer;
      font: 600 15px/1 system-ui, sans-serif; box-shadow: 0 12px 32px rgba(0,0,0,.28); }
    .tz-launcher:focus-visible { outline: 3px solid #2f4bff; outline-offset: 3px; }
    .tz-launcher-dot { width: 10px; height: 10px; border-radius: 50%; background: #2f4bff; box-shadow: 0 0 0 4px rgba(47,75,255,.35); }
    .tz-backdrop { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.45); display: none; }
    .tz-frame { position: fixed; z-index: 2147483002; inset: 4vh 4vw; width: 92vw; height: 92vh; max-width: 1280px; max-height: 860px;
      margin: auto; border: 0; border-radius: 16px; background: #fff; box-shadow: 0 30px 80px rgba(0,0,0,.4); display: none; }
    .tz-open .tz-backdrop, .tz-open .tz-frame { display: block; }
    @media (max-width: 720px) { .tz-frame { inset: 0; width: 100vw; height: 100dvh; max-height: none; border-radius: 0; } }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  const launcher = document.createElement('button');
  launcher.className = 'tz-launcher';
  launcher.type = 'button';
  launcher.innerHTML = '<span class="tz-launcher-dot"></span>Style me';
  const backdrop = document.createElement('div');
  backdrop.className = 'tz-backdrop';
  let frame = null;

  function open() {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'tz-frame';
      frame.title = 'Tryzeon Fashion Agent';
      frame.allow = 'clipboard-write';
      frame.src = `${origin}/agent.html?store=${encodeURIComponent(store)}`;
      root.appendChild(frame);
    }
    root.classList.add('tz-open');
    launcher.style.display = 'none';
    frame.focus();
  }

  function close() {
    root.classList.remove('tz-open');
    launcher.style.display = '';
    launcher.focus();
  }

  launcher.addEventListener('click', open);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('tz-open')) close();
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'tryzeon:close') close();
    if (e.data.type === 'tryzeon:product') {
      close();
      window.dispatchEvent(new CustomEvent('tryzeon:product', { detail: { id: e.data.id } }));
    }
  });

  root.append(launcher, backdrop);
  document.body.appendChild(root);
  window.Tryzeon = { open, close };
})();
