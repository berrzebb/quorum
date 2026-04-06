/**
 * Markdown → ANSI renderer for terminal display.
 *
 * Uses marked.lexer() for tokenization → chalk for ANSI coloring.
 * Lightweight alternative to Claude Code's full Markdown.tsx (which uses
 * marked + highlight.js + React components).
 *
 * Supported: headings, bold, italic, code spans, code blocks, links, lists, blockquotes.
 * Not supported: tables, images, HTML (stripped).
 */

import chalk from "chalk";

// marked is ESM-only in v14+, use dynamic import
let _lexer: ((src: string) => any[]) | null = null;

async function getLexer(): Promise<(src: string) => any[]> {
  if (_lexer) return _lexer;
  try {
    const m = await import("marked");
    _lexer = m.lexer;
    return _lexer!;
  } catch {
    // Fallback: return lines as-is
    return (src: string) => [{ type: "paragraph", text: src, tokens: [{ type: "text", text: src }] }];
  }
}

/** Token cache: avoid re-lexing identical strings. */
const tokenCache = new Map<string, string>();
const TOKEN_CACHE_MAX = 200;

/**
 * Render markdown string to ANSI-colored terminal text.
 * Synchronous if lexer is loaded, async on first call.
 */
export function renderMarkdown(src: string): string {
  if (!src || !src.trim()) return "";

  // Cache hit
  const cached = tokenCache.get(src);
  if (cached !== undefined) return cached;

  // Synchronous path if lexer already loaded
  if (_lexer) {
    const result = renderTokens(_lexer(src));
    cacheResult(src, result);
    return result;
  }

  // First call: lexer not loaded yet, return plain text
  // Next call will use cached lexer
  getLexer().catch(() => {});
  return src;
}

/** Render pre-lexed tokens to ANSI string. */
function renderTokens(tokens: any[]): string {
  const lines: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        lines.push(chalk.bold.cyan(renderInline(token.tokens ?? [])));
        lines.push("");
        break;

      case "paragraph":
        lines.push(renderInline(token.tokens ?? []));
        lines.push("");
        break;

      case "code":
        lines.push(chalk.dim("```" + (token.lang ?? "")));
        for (const line of (token.text ?? "").split("\n")) {
          lines.push(chalk.dim("  " + line));
        }
        lines.push(chalk.dim("```"));
        lines.push("");
        break;

      case "blockquote":
        const quoted = renderTokens(token.tokens ?? []);
        for (const line of quoted.split("\n")) {
          lines.push(chalk.dim("│ ") + line);
        }
        break;

      case "list": {
        const items = token.items ?? [];
        for (let i = 0; i < items.length; i++) {
          const bullet = token.ordered ? `${i + 1}.` : "•";
          const itemText = renderTokens(items[i].tokens ?? []).trim();
          lines.push(`  ${chalk.dim(bullet)} ${itemText}`);
        }
        lines.push("");
        break;
      }

      case "space":
        lines.push("");
        break;

      case "hr":
        lines.push(chalk.dim("─".repeat(40)));
        lines.push("");
        break;

      case "html":
        // Strip HTML
        break;

      default:
        // Fallback: render as text
        if (token.text) lines.push(token.text);
        break;
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Render inline tokens (bold, italic, code, link, text). */
function renderInline(tokens: any[]): string {
  let result = "";

  for (const token of tokens) {
    switch (token.type) {
      case "strong":
        result += chalk.bold(renderInline(token.tokens ?? []));
        break;
      case "em":
        result += chalk.italic(renderInline(token.tokens ?? []));
        break;
      case "codespan":
        result += chalk.cyan("`" + token.text + "`");
        break;
      case "link":
        result += chalk.blue.underline(token.text ?? token.href ?? "");
        break;
      case "text":
        result += token.text ?? "";
        break;
      case "escape":
        result += token.text ?? "";
        break;
      default:
        result += token.raw ?? token.text ?? "";
        break;
    }
  }

  return result;
}

function cacheResult(src: string, result: string) {
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    // Evict oldest (first inserted)
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(src, result);
}
