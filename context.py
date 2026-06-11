import subprocess
import webbrowser
from pathlib import Path
from typing import List  # type: ignore  # noqa: F401, UP035

output_file = "context.md"

exclude_names = {
    "__pycache__",
    ".venv",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    "context.py",
    "context.md",
    "README.md",
    "uv.lock",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "public",
    ".gitignore",
    ".vscode",
    "LICENSE",
    "README.md",
    "node_modules",
    "typechain-types",
    "artifacts",
    "cache",
    "research",
}

root = Path(".")


def is_excluded(path: Path) -> bool:
    return any(part in exclude_names for part in path.parts)
    # return any(part in exclude_names for part in path.parts) or any(
    #     part.startswith(".") for part in path.parts
    # )


def build_tree(directory: Path, prefix: str = "") -> List[str]:  # noqa: UP006
    entries = sorted(
        [p for p in directory.iterdir() if not is_excluded(p)],
        key=lambda p: (p.is_file(), p.name.lower()),
    )

    tree_lines = []

    for index, path in enumerate(entries):
        connector = "└── " if index == len(entries) - 1 else "├── "
        tree_lines.append(f"{prefix}{connector}{path.name}")  # type: ignore

        if path.is_dir():
            extension = "    " if index == len(entries) - 1 else "│   "
            tree_lines.extend(build_tree(path, prefix + extension))  # type: ignore

    return tree_lines  # type: ignore


with open(output_file, "w", encoding="utf-8") as outfile:
    # Project tree
    outfile.write("# PROJECT TREE\n\n")
    outfile.write("```text\n")
    outfile.write(".\n")

    for line in build_tree(root):
        outfile.write(f"{line}\n")

    outfile.write("```\n\n")

    # file contents
    outfile.write("# FILE CONTENTS\n")

    for path in sorted(root.rglob("*.*")):
        if is_excluded(path):
            continue

        outfile.write(f"\n\n# FILE: {path}\n\n")
        outfile.write("```plain\n")

        try:
            content = path.read_text(encoding="utf-8")
            outfile.write(content)
        except Exception as e:
            outfile.write(f"# ERROR READING FILE: {e}")

        outfile.write("\n```\n")

print(f"Created {output_file}")

absolute_path = Path(output_file).resolve()

try:
    # Detect WSL and convert Linux path -> Windows path
    windows_path = subprocess.check_output(
        ["wslpath", "-w", str(absolute_path)],
        text=True,
    ).strip()

    windows_path = windows_path.replace("\\", "/")

    file_url = f"file:///{windows_path}"

except Exception:
    # Normal Linux/macOS/Windows fallback
    file_url = absolute_path.as_uri()

print("\nOpen file:")
print(file_url)

try:
    webbrowser.open(file_url)
    print("\nFile opened successfully.")
except Exception as e:
    print(f"\nFailed to open file: {e}")
