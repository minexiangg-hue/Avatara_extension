const paths = {
  today: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  memory: '<path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v15l-4-2-4 2-4-2-4 2Z"/><path d="M8 8h8M8 12h6"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5A8.5 8.5 0 0 1 11.5 3h1a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M8 10h8M8 14h5"/>',
  settings: '<path d="m9 3-1 3-3 1v4l2 1v2l-2 1v4l3 1 1 2h5l1-2 3-1v-4l-2-1v-2l2-1V7l-3-1-1-3Z" transform="translate(1 -1) scale(.95)"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  bookmark: '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4Z"/>',
  external: '<path d="M14 3h7v7M21 3 11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  leaf: '<path d="M20 3C9 2 3 7 4 13s11 9 15 0c1-3 1-6 1-10ZM3 21l10-11"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-1-7-2 2M7 17l-2 2M5 5l2 2m10 10 2 2"/>',
  spark: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',
  page: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-9 6 6 0 0 1 12 2 3.5 3.5 0 0 1-1 7Z"/>',
};
export function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}
export const brandMark = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M29 29V17.8a9 9 0 1 0-4 7.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M25 26a5.2 5.2 0 1 1 .4-8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="29" cy="31" r="1.6" fill="currentColor"/></svg>';
