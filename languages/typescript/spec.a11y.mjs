/** Accessibility patterns for JSX/TSX. */
export default [
  { re: /<img\s+(?![^>]*alt\s*=)/m, label: "img-no-alt", severity: "high", msg: "<img> missing alt attribute" },
  { re: /<(?!button\b)\w+\s+onClick/m, label: "click-no-keyboard", severity: "medium", msg: "Non-button element with onClick — add keyboard handler or use <button>" },
  { re: /<div\s+onClick/m, label: "div-click", severity: "medium", msg: "<div> with onClick — use <button> or add role" },
  { re: /<(?:input|textarea|select)\s+(?![^>]*(?:aria-label|aria-labelledby|id\s*=))/m, label: "form-no-label", severity: "high", msg: "Form element missing label association" },
  { re: /tabIndex\s*=\s*\{?\s*-1/m, label: "negative-tabindex", severity: "low", msg: "Negative tabIndex removes from tab order" },
  { re: /aria-hidden\s*=\s*["']true["'][\s\S]{0,50}onClick/m, label: "hidden-interactive", severity: "high", msg: "aria-hidden on interactive element" },
  { re: /<a\s+(?![^>]*href)/m, label: "anchor-no-href", severity: "medium", msg: "<a> without href — not keyboard accessible" },
  { re: /style\s*=\s*\{\s*\{[^}]*display\s*:\s*["']?none/m, label: "css-hidden", severity: "low", msg: "CSS display:none — verify not hiding from assistive tech" },
];
