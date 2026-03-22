/**
 * Agent Persona Loader — 4-tier resolution with LRU cache.
 *
 * Resolution order:
 * 1. $QUORUM_AGENTS_DIR env var (user override)
 * 2. .quorum/agents/ in cwd (project-scoped)
 * 3. adapters/<provider>/agents/ in plugin dir (adapter default)
 * 4. Built-in fallback (empty persona)
 *
 * Personas are markdown files with ## sections.
 * Section extraction enables composable prompt assembly.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

export interface AgentPersona {
  name: string;
  source: string;
  content: string;
  sections: Map<string, string>;
}

export interface LoaderConfig {
  /** Quorum package root (for adapter defaults). */
  quorumRoot?: string;
  /** Adapter name (e.g., "claude-code"). */
  adapter?: string;
  /** Max cached personas (default: 20). */
  cacheSize?: number;
}

export class AgentLoader {
  private cache = new Map<string, AgentPersona>();
  private cacheOrder: string[] = [];
  private cacheSize: number;
  private searchPaths: string[];

  constructor(config: LoaderConfig = {}) {
    this.cacheSize = config.cacheSize ?? 20;
    this.searchPaths = buildSearchPaths(config);
  }

  /** Load an agent persona by name (without .md extension). */
  load(name: string): AgentPersona | null {
    // Cache hit
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    // Search through tiers
    for (const dir of this.searchPaths) {
      const filePath = resolve(dir, `${name}.md`);
      if (!existsSync(filePath)) continue;

      const content = readFileSync(filePath, "utf8");
      const persona: AgentPersona = {
        name,
        source: dir,
        content,
        sections: extractSections(content),
      };

      this.addToCache(name, persona);
      return persona;
    }

    return null;
  }

  /** Get a specific section from an agent persona. */
  getSection(name: string, section: string): string | null {
    const persona = this.load(name);
    if (!persona) return null;
    return persona.sections.get(section) ?? null;
  }

  /** List all available agent names across all tiers. */
  listAvailable(): string[] {
    const names = new Set<string>();

    for (const dir of this.searchPaths) {
      if (!existsSync(dir)) continue;
      try {
        for (const file of readdirSync(dir)) {
          if (file.endsWith(".md")) {
            names.add(basename(file, ".md"));
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    return [...names].sort();
  }

  /** Get the resolution path that would be used for a given agent. */
  resolvedPath(name: string): string | null {
    for (const dir of this.searchPaths) {
      const filePath = resolve(dir, `${name}.md`);
      if (existsSync(filePath)) return filePath;
    }
    return null;
  }

  /** Clear the cache. */
  clearCache(): void {
    this.cache.clear();
    this.cacheOrder = [];
  }

  // ── LRU cache management ──────────────────

  private addToCache(name: string, persona: AgentPersona): void {
    if (this.cache.has(name)) {
      // Move to end (most recent)
      const idx = this.cacheOrder.indexOf(name);
      if (idx !== -1) this.cacheOrder.splice(idx, 1);
    } else if (this.cacheOrder.length >= this.cacheSize) {
      // Evict least recently used
      const evict = this.cacheOrder.shift()!;
      this.cache.delete(evict);
    }

    this.cache.set(name, persona);
    this.cacheOrder.push(name);
  }
}

// ── Section extraction ────────────────────────

function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  let currentSection: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      if (currentSection) {
        sections.set(currentSection, currentLines.join("\n").trim());
      }
      currentSection = match[1]!.trim();
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentLines.join("\n").trim());
  }

  return sections;
}

// ── Search path builder ───────────────────────

function buildSearchPaths(config: LoaderConfig): string[] {
  const paths: string[] = [];

  // Tier 1: env var override
  const envDir = process.env.QUORUM_AGENTS_DIR;
  if (envDir && existsSync(envDir)) {
    paths.push(envDir);
  }

  // Tier 2: project-scoped
  const projectDir = resolve(process.cwd(), ".quorum", "agents");
  paths.push(projectDir);

  // Tier 3: adapter default
  if (config.quorumRoot && config.adapter) {
    const adapterDir = resolve(config.quorumRoot, "adapters", config.adapter, "agents");
    paths.push(adapterDir);
  }

  // Tier 4: built-in (quorum root agents/)
  if (config.quorumRoot) {
    paths.push(resolve(config.quorumRoot, "agents"));
  }

  return paths;
}
