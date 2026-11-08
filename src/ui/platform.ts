/** The key shortcuts are held with here: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl ';
