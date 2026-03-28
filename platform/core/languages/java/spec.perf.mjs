export default [
  { re: /for\s*\([^)]+\)\s*\{[\s\S]{0,200}for\s*\(/m, label: "nested-loop", severity: "high", msg: "Nested for loops — potential O(n²)" },
  { re: /new\s+String\s*\(/m, label: "string-constructor", severity: "low", msg: "new String() — use string literal" },
  { re: /\.toString\(\)\s*\+/m, label: "string-concat-loop", severity: "medium", msg: "String concat with toString() — use StringBuilder" },
  { re: /SELECT\s+\*\s+FROM/im, label: "select-star", severity: "medium", msg: "SELECT * — fetch only needed columns" },
  { re: /synchronized\s*\([^)]+\)\s*\{[\s\S]{0,300}synchronized/m, label: "nested-sync", severity: "high", msg: "Nested synchronized — deadlock risk" },
  { re: /Thread\.sleep\s*\(/m, label: "thread-sleep", severity: "medium", msg: "Thread.sleep() — consider ScheduledExecutor" },
  { re: /System\.gc\s*\(\)/m, label: "manual-gc", severity: "medium", msg: "System.gc() — avoid manual GC in production" },
];
