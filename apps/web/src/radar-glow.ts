// Radar border glow effect on the sidebar — single global mousemove listener.
// From ui-dashboard skill: radial-gradient that tracks cursor for ambient depth.

export function startRadarGlow(root: HTMLElement): void {
  const sidebar = root.querySelector<HTMLElement>(".area-sidebar");
  if (!sidebar) return;

  // Honor reduced-motion preference; bail if user prefers no animation.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  sidebar.style.setProperty("--cursor-x", "50%");
  sidebar.style.setProperty("--cursor-y", "50%");

  // ponytail: no per-card listeners; one global handler is enough and cheaper.
  document.addEventListener("mousemove", (e) => {
    const rect = sidebar.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) return;
    sidebar.style.setProperty("--cursor-x", `${e.clientX - rect.left}px`);
    sidebar.style.setProperty("--cursor-y", `${e.clientY - rect.top}px`);
  });
}