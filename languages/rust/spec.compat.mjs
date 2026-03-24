export default [
  { re: /#\[deprecated/m, label: "deprecated-usage", severity: "medium", msg: "#[deprecated] attribute present" },
  { re: /\/\/\s*TODO.*(?:remove|delete|deprecat)/im, label: "pending-removal", severity: "medium", msg: "Pending removal marked in TODO" },
  { re: /#!\[feature\(/m, label: "nightly-feature", severity: "medium", msg: "Nightly feature gate — not stable Rust" },
];
