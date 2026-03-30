/**
 * Prompt file I/O — write and cleanup prompt/script files for agent sessions.
 *
 * Pure file management. No provider logic, no session lifecycle.
 */

import { existsSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Write a prompt file to the temp directory.
 * @returns Absolute path to the written file.
 */
export function writePromptFile(content: string, dir: string, name: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, name);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Write a platform-appropriate shell script that pipes a prompt file into a provider CLI.
 * @returns Absolute path to the written script file.
 */
export function writeScriptFile(
  dir: string, sessionName: string, promptFile: string,
  outputFile: string, provider: string, cliFlags: string,
): string {
  const isWin = process.platform === "win32";
  const scriptFile = resolve(dir, `${sessionName}${isWin ? ".cmd" : ".sh"}`);
  const escapedPrompt = promptFile.replace(/\\/g, "\\\\");
  const escapedOutput = outputFile.replace(/\\/g, "\\\\");

  if (isWin) {
    writeFileSync(scriptFile, `@type "${escapedPrompt}" | ${provider} ${cliFlags} > "${escapedOutput}" 2>&1\n`, "utf8");
  } else {
    writeFileSync(scriptFile, `#!/bin/sh\ncat "${escapedPrompt}" | ${provider} ${cliFlags} > "${escapedOutput}" 2>&1\n`, { mode: 0o755 });
  }
  return scriptFile;
}

/**
 * Remove all temp files in a directory (prompt, output, script files).
 */
export function cleanupPromptFiles(dir: string): void {
  if (!existsSync(dir)) return;
  try {
    for (const entry of readdirSync(dir)) {
      try { rmSync(resolve(dir, entry), { force: true }); } catch (err) { console.warn(`[prompt-files] file removal failed for ${entry}: ${(err as Error).message}`); }
    }
  } catch (err) { console.warn(`[prompt-files] cleanup failed for ${dir}: ${(err as Error).message}`); }
}
