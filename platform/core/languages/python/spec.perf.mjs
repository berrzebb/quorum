export default [
  { re: /for\s+\w+\s+in\s+.*:\s*\n\s+for\s+\w+/m, label: "nested-loop", severity: "high", msg: "Nested for loops — potential O(n²)" },
  { re: /\.read\(\)/m, label: "unbounded-read", severity: "medium", msg: "file.read() without size limit — memory risk on large files" },
  { re: /time\.sleep\(/m, label: "blocking-sleep", severity: "medium", msg: "time.sleep() blocks the thread" },
  { re: /\+\s*=\s*.*\bstr\b|\bstr\s*\(/m, label: "string-concat-loop", severity: "low", msg: "String concatenation — consider join() or f-string" },
  { re: /SELECT\s+\*\s+FROM/im, label: "select-star", severity: "medium", msg: "SELECT * — fetch only needed columns" },
  { re: /import\s+pandas/m, label: "heavy-import", severity: "low", msg: "pandas imported — verify necessity in non-data modules" },
  { re: /\.fetchall\(\)/m, label: "unbounded-query", severity: "high", msg: "fetchall() without LIMIT — memory risk" },
  { re: /while\s+True:/m, label: "busy-loop", severity: "high", msg: "while True — ensure break/sleep exists" },
  { re: /global\s+\w+/m, label: "global-var", severity: "medium", msg: "Global variable mutation — consider passing as parameter" },
];
