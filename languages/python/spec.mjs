/**
 * Python — core language spec.
 */
export default {
  id: "python",
  name: "Python",
  extensions: [".py", ".pyi"],
  endBlock: "indent",
  commentPrefixes: ["#"],
  verify: {
    CQ:   { cmd: "ruff check .", detect: ["pyproject.toml", "setup.py", "requirements.txt"] },
    T:    { cmd: "mypy .", detect: ["mypy.ini", "pyproject.toml"] },
    TEST: { cmd: "pytest", detect: ["pyproject.toml", "setup.py"] },
    DEP:  { cmd: "pip-audit", detect: ["requirements.txt", "pyproject.toml"] },
  },
};
