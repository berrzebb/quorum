export default [
  { re: /\/\/\s*Deprecated:/m, label: "deprecated-usage", severity: "medium", msg: "Contains Deprecated: marker" },
  { re: /\/\/\s*TODO.*(?:remove|delete|deprecat)/im, label: "pending-removal", severity: "medium", msg: "Pending removal marked in TODO" },
  { re: /\/\/go:build\s+ignore/m, label: "build-ignore", severity: "low", msg: "Build constraint: file ignored" },
];
