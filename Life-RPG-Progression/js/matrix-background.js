/* Dense Matrix rain with falling code characters. Pure Canvas; no dependencies. */
(() => {
  const canvas = document.getElementById('matrixBackground');
  const toggle = document.getElementById('matrixToggle');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chars = 'アカサタナハマヤラワ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$+-*/=<>{}[]';
  let width = 0, height = 0, columns = [], fontSize = 12, raf = 0, last = 0;
  let enabled = !reduced;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fontSize = width < 600 ? 10 : 12;
    // Narrower character spacing means more independent rain streams.
    columns = Array.from({length: Math.ceil(width / fontSize)}, () => ({ y: Math.random() * -height / fontSize, speed: .55 + Math.random() * 1.2, bright: Math.random() > .92 }));
    ctx.fillStyle = '#020704'; ctx.fillRect(0, 0, width, height);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!enabled || now - last < 42) return;
    last = now;
    // Longer fade means longer trails; transparent fill keeps the rain continuous.
    ctx.fillStyle = 'rgba(2, 7, 4, 0.085)';
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${fontSize}px monospace`;
    for (let i = 0; i < columns.length; i++) {
      const stream = columns[i];
      const x = i * fontSize;
      // Draw a small cluster down each stream for a fuller Matrix wall.
      const cluster = stream.bright ? 2 : 1;
      for (let n = 0; n < cluster; n++) {
        const y = stream.y * fontSize - n * fontSize * .92;
        if (y > -fontSize && y < height + fontSize) {
          ctx.fillStyle = n === 0 && stream.bright ? '#e3ffed' : (n === 0 ? '#42ff8a' : '#16a852');
          ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, y);
        }
      }
      if (stream.y * fontSize > height && Math.random() > .965) {
        stream.y = -Math.random() * 35;
        stream.speed = .55 + Math.random() * 1.2;
        stream.bright = Math.random() > .88;
      }
      stream.y += stream.speed;
    }

  }

  function setEnabled(on) {
    enabled = on && !reduced;
    document.body.classList.toggle('matrix-off', !enabled);
    if (toggle) {
      toggle.textContent = enabled ? '☷ Matrix background: on' : '☷ Matrix background: off';
      toggle.setAttribute('aria-pressed', String(enabled));
    }
    cancelAnimationFrame(raf);
    if (enabled) {
      ctx.fillStyle = '#020704'; ctx.fillRect(0, 0, width, height);
      last = 0; raf = requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  }

  toggle?.addEventListener('click', () => setEnabled(!enabled));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (enabled) raf = requestAnimationFrame(frame);
  });
  window.addEventListener('resize', resize, { passive: true });
  resize(); setEnabled(enabled);
})();
