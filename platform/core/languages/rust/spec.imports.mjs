export default {
  patterns: [
    /^use\s+(\S+);/m,
    /^(?:extern\s+crate|mod)\s+(\w+)/m,
  ],
  resolve: "exact",
  packageIndicator: /^(?!crate|self|super)/,
};
