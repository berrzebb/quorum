export default [
  { re: /\.unwrap\(\)/m, label: "unwrap-usage", severity: "medium", msg: ".unwrap() — handle error or use expect() with context" },
  { re: /\.expect\(\s*"[^"]{0,5}"\s*\)/m, label: "vague-expect", severity: "low", msg: ".expect() with short message — add descriptive context" },
  { re: /println!\s*\(/m, label: "println-debug", severity: "low", msg: "println! in source — use tracing/log crate" },
  { re: /panic!\s*\(/m, label: "panic-usage", severity: "medium", msg: "panic!() — use Result<T, E> in library code" },
  { re: /todo!\s*\(/m, label: "todo-macro", severity: "medium", msg: "todo!() macro — incomplete implementation" },
  { re: /unimplemented!\s*\(/m, label: "unimplemented", severity: "medium", msg: "unimplemented!() — will panic at runtime" },
];
