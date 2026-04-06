/**
 * DUX-6: App Shell and View Registry.
 *
 * Shell wrapper providing view routing and layout structure.
 * Pure state management — no React/Ink rendering yet (rendering added in DUX-8).
 */

/**
 * View descriptor for the shell.
 */
export interface ViewDescriptor {
  id: DaemonView;
  title: string;
  shortcut: string;
  defaultFocus?: string;
}

export type DaemonView = "overview" | "review" | "chat" | "operations";

/**
 * View registry — single source of truth for available views.
 */
export const VIEW_REGISTRY: ViewDescriptor[] = [
  { id: "overview", title: "Overview", shortcut: "1", defaultFocus: "overview.gates" },
  { id: "review", title: "Review", shortcut: "2", defaultFocus: "review.findings" },
  { id: "chat", title: "Chat", shortcut: "3", defaultFocus: "chat.sessions" },
  { id: "operations", title: "Operations", shortcut: "4", defaultFocus: "operations.providers" },
];

/**
 * Shell state for the daemon.
 */
export interface DaemonShellState {
  activeView: DaemonView;
  focusedRegion: string | null;
  overlay: "none" | "help" | "command";
  density: "comfortable" | "compact";
}

/**
 * Initial shell state.
 */
export function initialShellState(): DaemonShellState {
  return {
    activeView: "overview",
    focusedRegion: "overview.gates",
    overlay: "none",
    density: "comfortable",
  };
}

/**
 * Shell action for reducing state.
 */
export type ShellAction =
  | { type: "SET_VIEW"; view: DaemonView }
  | { type: "SET_FOCUS"; region: string | null }
  | { type: "SET_OVERLAY"; overlay: DaemonShellState["overlay"] }
  | { type: "SET_DENSITY"; density: DaemonShellState["density"] };

/**
 * Shell state reducer.
 */
export function shellReducer(state: DaemonShellState, action: ShellAction): DaemonShellState {
  switch (action.type) {
    case "SET_VIEW": {
      const view = VIEW_REGISTRY.find(v => v.id === action.view);
      return {
        ...state,
        activeView: action.view,
        focusedRegion: view?.defaultFocus ?? null,
      };
    }
    case "SET_FOCUS":
      return { ...state, focusedRegion: action.region };
    case "SET_OVERLAY":
      return { ...state, overlay: action.overlay };
    case "SET_DENSITY":
      return { ...state, density: action.density };
    default:
      return state;
  }
}
