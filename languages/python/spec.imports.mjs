export default {
  patterns: [/^from\s+(\S+)\s+import/m, /^import\s+(\S+)/m],
  resolve: "init-py",
  packageIndicator: /^[^.]/,
};
