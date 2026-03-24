# ai_guide

Generate project onboarding guide by synthesizing code_map + dependency_graph + doc_coverage results.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--target` | string | ✓ | Directory to analyze |

## Example

```bash
node tool-runner.mjs ai_guide --target src/
```

## Output

Synthesized overview combining:
- Symbol map (from code_map)
- Dependency structure (from dependency_graph)
- Documentation gaps (from doc_coverage)
- Suggested reading order for new contributors
