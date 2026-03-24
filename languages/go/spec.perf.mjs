export default [
  { re: /\bstring\b.*\+.*\bstring\b/m, label: "string-concat", severity: "medium", msg: "String concatenation — use strings.Builder in loops" },
  { re: /defer\b[\s\S]{0,60}\.Close\(\)/m, label: "defer-in-loop", severity: "medium", msg: "defer in potential loop — resource leak risk" },
  { re: /reflect\.\w+/m, label: "reflect-usage", severity: "low", msg: "reflect package — performance impact in hot paths" },
  { re: /SELECT\s+\*\s+FROM/im, label: "select-star", severity: "medium", msg: "SELECT * — fetch only needed columns" },
  { re: /sync\.Mutex[\s\S]{0,200}sync\.Mutex/m, label: "nested-lock", severity: "high", msg: "Multiple mutex in proximity — deadlock risk" },
  { re: /for\s+.*range[\s\S]{0,100}for\s+.*range/m, label: "nested-loop", severity: "high", msg: "Nested range loops — potential O(n²)" },
  { re: /append\(.*append\(/m, label: "nested-append", severity: "low", msg: "Nested append — consider pre-allocating slice" },
];
