export default {
  exportRe: /^(?:public)\s+(?:(?:abstract|final|static)\s+)*(?:class|interface|enum|(?:\w+(?:<[^>]*>)?)\s+\w+\s*\()\s*(\w+)/m,
  docStartRe: /\/\*\*/,
};
