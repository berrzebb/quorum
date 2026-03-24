import React from "react";
import { Box, Text } from "ink";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    const candidates = [
      resolve(__dirname, "..", "..", "package.json"),
      resolve(__dirname, "..", "..", "..", "package.json"),
    ];
    for (const p of candidates) {
      try {
        return JSON.parse(readFileSync(p, "utf8")).version ?? "unknown";
      } catch { /* next */ }
    }
  } catch { /* fallback */ }
  return "unknown";
}

const VERSION = getVersion();

interface ProviderInfo {
  name: string;
  connected: boolean;
  activeAgents: number;
  pendingAudits: number;
  error?: string;
}

interface HeaderProps {
  activeView: string;
  providers: ProviderInfo[];
}

export function Header({ providers }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text bold color="cyan">QUORUM</Text>
        <Text dimColor>v{VERSION}</Text>
        <Text> | </Text>
        {providers.map((p, i) => (
          <React.Fragment key={p.name}>
            {i > 0 && <Text> </Text>}
            <Text color={p.connected ? "green" : "red"}>
              {p.connected ? "●" : "○"}
            </Text>
            <Text> {p.name}</Text>
            {p.activeAgents > 0 && (
              <Text dimColor> ({p.activeAgents} agents)</Text>
            )}
            {p.pendingAudits > 0 && (
              <Text color="yellow"> [{p.pendingAudits} auditing]</Text>
            )}
          </React.Fragment>
        ))}
      </Box>
      <Text dimColor>{"─".repeat(60)}</Text>
    </Box>
  );
}
