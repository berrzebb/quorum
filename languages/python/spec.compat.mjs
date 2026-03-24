export default [
  { re: /@deprecated/m, label: "deprecated-usage", severity: "medium", msg: "Contains @deprecated marker" },
  { re: /#\s*TODO.*(?:remove|delete|deprecat)/im, label: "pending-removal", severity: "medium", msg: "Pending removal marked in TODO" },
  { re: /from\s+__future__\s+import/m, label: "future-import", severity: "low", msg: "__future__ import — check Python version requirement" },
];
