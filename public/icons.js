const paths = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', back: '<path d="m15 5-7 7 7 7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shell: '<path d="M12 21C8 18 2 13 2 8c0-3 3-5 5-3 0-5 10-5 10 0 2-2 5 0 5 3 0 5-6 10-10 13ZM12 20V3M7 5l5 15 5-15M3 8l9 12 9-12M9 22h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  check: '<path d="m5 12 4 4L19 6"/>', people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2"/>',
  share: '<path d="M12 16V2m-5 5 5-5 5 5M6 10H4v12h16V10h-2"/>', copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  qr: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><path d="M8 8h2v2H8zm6 0h2v2h-2zM8 14h2v2H8zm6 0h2v2h-2z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 3m0 3v.1"/>',
  settings: '<path d="m9 3 1-2h4l1 2 3 2 2-1 2 4-1 2v4l1 2-2 4-2-1-3 2-1 2h-4l-1-2-3-2-2 1-2-4 1-2v-4L1 8l2-4 2 1Z"/><circle cx="12" cy="12" r="3"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v10h14V12M12 8v14m0-14C2 8 5-2 9 2c2 2 3 6 3 6s1-4 3-6c4-4 7 6-3 6Z"/>',
  carriage: '<path d="M3 11h18a9 9 0 0 1-18 0Zm9 0V2a9 9 0 0 1 9 9M3 11 1 7H0"/><circle cx="6" cy="22" r="1.5"/><circle cx="18" cy="22" r="1.5"/>',
  home: '<path d="m2 10 10-8 10 8M5 8v14h14V8m-7 3c-4-3-6 2 0 6 6-4 4-9 0-6Z"/>',
  chat: '<path d="M21 11c0 5-4 8-9 8a12 12 0 0 1-4-.6L2 21l2-6a8 8 0 0 1-1-4c0-5 4-8 9-8s9 3 9 8Z"/><path d="M8 11h.1m4 0h.1m4 0h.1"/>',
  vote: '<path d="M3 12v9h18v-9M3 12h5m8 0h5M9 9l5-7 6 5-5 7Z"/>', search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7"/>',
  edit: '<path d="m3 17-1 5 5-1L21 7l-6-6L1 15m12-12 6 6"/>', plus: '<path d="M12 4v16M4 12h16"/>',
  pause: '<path d="M8 5v14M16 5v14"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6h4M9 1h6"/>',
  wifi: '<path d="M2 7a16 16 0 0 1 20 0M5 11a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 5h.1"/>',
  warning: '<circle cx="12" cy="12" r="10"/><path d="M12 6v7m0 4v.1"/>', dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  sound: '<path d="M11 4 5 9H1v6h4l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', sparkle: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>', trash: '<path d="M3 6h18M9 6V2h6v4M5 6l1 16h12l1-16M10 10v8m4-8v8"/>',
};
export function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.shell}</svg>`; }
export function shellSun() { return `<div class="shell-sun" aria-hidden="true"><div class="sun-rays"></div>${icon('shell')}</div>`; }
