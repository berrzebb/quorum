export default {
  patterns: [
    /^import\s+(?:static\s+)?([^;]+);/m,
  ],
  resolve: "exact",
  packageIndicator: /^(?!\.)/,
};
