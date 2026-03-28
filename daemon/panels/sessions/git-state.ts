/**
 * Git sidebar data snapshot and state management.
 *
 * Pure state — no React dependency. Manages scroll offsets for
 * commit graph and changed files independently.
 *
 * Created for DUX-12: scrollable right sidebar commit graph.
 */

/**
 * Git sidebar data snapshot.
 */
export interface GitSidebarSnapshot {
  commits: Array<{
    sha: string;
    graph: string;
    summary: string;
    author?: string;
    age?: string;
  }>;
  changedFiles: Array<{
    path: string;
    status: "A" | "M" | "D" | "R" | "?";
  }>;
  commitScrollOffset: number;
  filesScrollOffset: number;
}

/**
 * Create an empty git sidebar snapshot.
 */
export function emptyGitSnapshot(): GitSidebarSnapshot {
  return {
    commits: [],
    changedFiles: [],
    commitScrollOffset: 0,
    filesScrollOffset: 0,
  };
}

/**
 * Parse `git log --graph --oneline --decorate -n N` output into commit objects.
 */
export function parseGitLog(rawLines: string[]): GitSidebarSnapshot["commits"] {
  return rawLines
    .filter(line => line.trim().length > 0)
    .map(line => {
      const trimmed = line.trimStart();

      // Lines look like: "* abc1234 (HEAD -> main) commit message"
      // or "| * abc1234 commit message"
      // Extract graph prefix (everything before the SHA)
      const shaMatch = trimmed.match(/([0-9a-f]{7,40})\s/);
      if (!shaMatch) {
        return { sha: "", graph: trimmed, summary: trimmed };
      }

      const shaIdx = trimmed.indexOf(shaMatch[1]);
      const graph = trimmed.slice(0, shaIdx).trim();
      const rest = trimmed.slice(shaIdx);

      // SHA is first token
      const sha = shaMatch[1];
      const summary = rest.slice(sha.length).trim();

      return { sha, graph, summary };
    });
}

/**
 * Parse `git status --porcelain` or `git diff --name-status` output.
 */
export function parseChangedFiles(rawLines: string[]): GitSidebarSnapshot["changedFiles"] {
  return rawLines
    .filter(line => line.trim().length > 0)
    .map(line => {
      const trimmed = line.trim();
      const status = trimmed[0] as "A" | "M" | "D" | "R" | "?";
      const path = trimmed.slice(1).trim();
      // Validate status; fall back to "?" for unknown
      return {
        path,
        status: (["A", "M", "D", "R", "?"] as const).includes(status) ? status : "?" as const,
      };
    });
}

/**
 * Git sidebar state manager — manages scroll state for both panes.
 */
export class GitSidebarState {
  private snapshot: GitSidebarSnapshot = emptyGitSnapshot();

  /**
   * Update the git data (commits + files).
   * Does NOT reset scroll offsets — those are preserved across data updates.
   */
  updateData(
    commits: GitSidebarSnapshot["commits"],
    changedFiles: GitSidebarSnapshot["changedFiles"],
  ): void {
    this.snapshot.commits = commits;
    this.snapshot.changedFiles = changedFiles;
    // Clamp scroll offsets to valid range
    this.snapshot.commitScrollOffset = Math.min(
      this.snapshot.commitScrollOffset,
      Math.max(0, commits.length - 1),
    );
    this.snapshot.filesScrollOffset = Math.min(
      this.snapshot.filesScrollOffset,
      Math.max(0, changedFiles.length - 1),
    );
  }

  /**
   * Scroll commit graph by delta.
   */
  scrollCommits(delta: number): void {
    const maxOffset = Math.max(0, this.snapshot.commits.length - 1);
    this.snapshot.commitScrollOffset = Math.max(
      0,
      Math.min(maxOffset, this.snapshot.commitScrollOffset + delta),
    );
  }

  /**
   * Scroll changed files by delta.
   */
  scrollFiles(delta: number): void {
    const maxOffset = Math.max(0, this.snapshot.changedFiles.length - 1);
    this.snapshot.filesScrollOffset = Math.max(
      0,
      Math.min(maxOffset, this.snapshot.filesScrollOffset + delta),
    );
  }

  /**
   * Jump commit graph to top/bottom.
   */
  jumpCommits(position: "top" | "bottom"): void {
    this.snapshot.commitScrollOffset = position === "top"
      ? 0
      : Math.max(0, this.snapshot.commits.length - 1);
  }

  /**
   * Jump changed files to top/bottom.
   */
  jumpFiles(position: "top" | "bottom"): void {
    this.snapshot.filesScrollOffset = position === "top"
      ? 0
      : Math.max(0, this.snapshot.changedFiles.length - 1);
  }

  /**
   * Get current snapshot (read-only).
   */
  getSnapshot(): Readonly<GitSidebarSnapshot> {
    return this.snapshot;
  }
}
