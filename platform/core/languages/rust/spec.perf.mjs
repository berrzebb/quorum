export default [
  { re: /\.clone\(\)/m, label: "clone-usage", severity: "low", msg: ".clone() — verify ownership requires it" },
  { re: /\.collect::<Vec<[\s\S]{0,30}>>\(\)[\s\S]{0,50}\.iter\(\)/m, label: "collect-reiter", severity: "medium", msg: "collect() then re-iterate — use iterator chain" },
  { re: /String::from\([^)]*\)/m, label: "string-alloc", severity: "low", msg: "String::from() — consider &str if ownership not needed" },
  { re: /\.to_string\(\)/m, label: "to-string", severity: "low", msg: ".to_string() in loop — check for allocation" },
  { re: /for\s+\w+\s+in\s+.*\{[\s\S]{0,200}for\s+\w+\s+in/m, label: "nested-loop", severity: "high", msg: "Nested for loops — potential O(n²)" },
  { re: /Box::new\(.*Box::new/m, label: "nested-box", severity: "medium", msg: "Nested Box — consider flattening allocation" },
  { re: /Arc::new\(Mutex::new\(/m, label: "arc-mutex", severity: "low", msg: "Arc<Mutex<T>> — consider RwLock if reads dominate" },
];
