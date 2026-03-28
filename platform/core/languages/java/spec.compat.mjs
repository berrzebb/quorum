export default [
  { re: /@Deprecated/m, label: "deprecated-usage", severity: "medium", msg: "@Deprecated annotation present" },
  { re: /\/\/\s*TODO.*(?:remove|delete|deprecat)/im, label: "pending-removal", severity: "medium", msg: "Pending removal marked in TODO" },
  { re: /@SuppressWarnings/m, label: "suppress-warnings", severity: "low", msg: "@SuppressWarnings — verify suppression is justified" },
];
