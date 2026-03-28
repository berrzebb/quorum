/**
 * FindingDetail — shows expanded info for a selected finding.
 *
 * Part of finding list → drill-down flow (DUX-13).
 */

import React from "react";
import { Box, Text } from "ink";

interface FindingDetailProps {
  finding: {
    id: string;
    severity: string;
    file: string;
    line?: number;
    description: string;
    category?: string;
    reviewerId?: string;
    provider?: string;
  } | null;
}

/**
 * Finding detail — shows expanded info for a selected finding.
 */
export function FindingDetail({ finding }: FindingDetailProps): React.ReactElement {
  if (!finding) {
    return <Box><Text dimColor>Select a finding to view details</Text></Box>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>[{finding.severity}] {finding.id}</Text>
      <Text>File: {finding.file}{finding.line ? `:${finding.line}` : ""}</Text>
      <Text>{finding.description}</Text>
      {finding.category && <Text dimColor>Category: {finding.category}</Text>}
      {finding.reviewerId && <Text dimColor>Reviewer: {finding.reviewerId} ({finding.provider})</Text>}
    </Box>
  );
}
