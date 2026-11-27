// Player tooltips follow the mouse instead of sitting over the list. With a mouse, each tooltip is
// placed next to the cursor (flipped to the other side near the edges of the window); keyboard
// focus and touch keep the tooltip above the name, as the CSS has it.

export function followTips() {
  if (typeof window === 'undefined' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.documentElement.classList.add('tips-follow');
  document.addEventListener('mousemove', (e) => {
    const host = (e.target as Element | null)?.closest?.('.ptip');
    const box = host?.querySelector<HTMLElement>(':scope > .ptip-box');
    if (!box) return;
    const w = box.offsetWidth || 260;
    const h = box.offsetHeight || 220;
    let x = e.clientX + 18;
    let y = e.clientY + 16;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 18;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 12;
    box.style.setProperty('--tip-x', `${Math.max(8, x)}px`);
    box.style.setProperty('--tip-y', `${Math.max(8, y)}px`);
  }, { passive: true });
}
