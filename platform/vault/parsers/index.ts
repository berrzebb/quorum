/**
 * Session Parser — auto-detects provider and parses session files.
 *
 * Tries each registered parser in order until one can handle the file.
 */

import { readFileSync } from "node:fs";
import type { Session, SessionParser } from "../session-model.js";
import { claudeCodeParser } from "./claude-code.js";
import { codexParser } from "./codex.js";
import { geminiParser } from "./gemini.js";

const PARSERS: SessionParser[] = [
  geminiParser,       // Check .json first (unique to Gemini)
  codexParser,        // Check JSONL with role-only format
  claudeCodeParser,   // Default JSONL fallback
];

/**
 * Parse a session file into the unified model.
 * Auto-detects provider from file extension and content.
 */
export function parseSession(filePath: string): Session {
  let firstLine = "";
  try {
    const content = readFileSync(filePath, "utf8");
    firstLine = content.split("\n").find(l => l.trim()) ?? "";
  } catch { /* will fail in parser */ }

  for (const parser of PARSERS) {
    if (parser.canParse(filePath, firstLine)) {
      return parser.parse(filePath);
    }
  }

  throw new Error(`No parser found for ${filePath}`);
}

export { claudeCodeParser, codexParser, geminiParser };
