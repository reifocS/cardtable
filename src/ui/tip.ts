/**
 * Props for a styled tooltip (see [data-tip] in styles.css), shown above by default and below in
 * the top bar and opponent headers. `end` right-aligns it, for buttons near the right edge.
 * Also sets aria-label, so icon-only buttons have an accessible name.
 */
export function tip(text: string, align?: 'end') {
  return { 'data-tip': text, 'aria-label': text, ...(align && { 'data-tip-align': align }) };
}
