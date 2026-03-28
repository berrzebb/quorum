export default [
  { re: /eval\s*\(/m, label: "eval-usage", severity: "critical", msg: "eval() — code injection risk" },
  { re: /exec\s*\(/m, label: "exec-usage", severity: "critical", msg: "exec() — code injection risk" },
  { re: /subprocess\.(?:call|run|Popen)\(.*shell\s*=\s*True/m, label: "shell-injection", severity: "critical", msg: "shell=True — command injection risk" },
  { re: /pickle\.loads?\(/m, label: "pickle-deser", severity: "high", msg: "pickle deserialization — arbitrary code execution risk" },
  { re: /yaml\.load\(\s*[^)]*\)/m, label: "yaml-unsafe", severity: "high", msg: "yaml.load() without SafeLoader — use yaml.safe_load()" },
  { re: /marshal\.loads?\(/m, label: "marshal-deser", severity: "high", msg: "marshal deserialization — unsafe on untrusted data" },
  { re: /\bos\.system\s*\(/m, label: "os-system", severity: "high", msg: "os.system() — use subprocess with shell=False" },
  { re: /__import__\s*\(/m, label: "dynamic-import", severity: "medium", msg: "__import__() — validate module name" },
];
