import React from "react";
import { Box, Text } from "ink";

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
        <Text dimColor>v{process.env.npm_package_version ?? "0.2.0"}</Text>
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
