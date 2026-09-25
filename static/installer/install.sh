#!/usr/bin/env bash
# Dev Starter Kit — macOS installer.
# Installs: Homebrew, Git, Node.js, Claude Code, VS Code, Python, uv, opencode,
# Antigravity, GitHub Desktop, Google Chrome, and a set of Python dev packages.
# Safe to re-run: anything already installed is skipped.
#
# Run from the unzipped kit, or straight from the web:
#   curl -fsSL https://www.eating.computer/installer/install.sh | bash

set -u
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
LIST_URL="https://www.eating.computer/installer"
PY_VERSION="3.13"
VENV="$HOME/.venvs/dev"

ok=(); skipped=(); failed=()
bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

# Read a package list, ignoring comments and blank lines. Uses the copy next to
# this script when there is one, otherwise the published copy (curl | bash).
read_list() {
  if [ -f "$KIT_DIR/$1" ]; then cat "$KIT_DIR/$1"; else curl -fsSL "$LIST_URL/$1"; fi \
    | grep -vE '^[[:space:]]*(#|$)' | sed 's/[[:space:]]*$//'
}

# ---------------------------------------------------------------- prerequisites
bold "Xcode Command Line Tools"
if xcode-select -p >/dev/null 2>&1; then
  note "already installed"
else
  xcode-select --install 2>/dev/null
  note "A system dialog opened — click Install. This script continues once it finishes."
  until xcode-select -p >/dev/null 2>&1; do sleep 5; done
  note "installed"
fi

# Homebrew and several apps need admin rights. Ask for the password once, up
# front (stdin is the script itself under curl | bash, so read from the
# terminal), and keep sudo warm so nothing later stops to ask again.
bold "Administrator access"
if ! id -Gn | tr ' ' '\n' | grep -qx admin; then
  echo "This Mac account ($USER) is not an Administrator, and Homebrew needs one." >&2
  echo "Ask whoever manages this Mac to make you an admin (System Settings → Users & Groups), then re-run." >&2
  exit 1
fi
note "Enter your Mac login password (nothing shows as you type):"
if ! sudo -v </dev/tty; then
  echo "Couldn't get administrator access; nothing else can proceed." >&2
  exit 1
fi
while true; do sudo -n true; sleep 50; kill -0 "$$" || exit; done 2>/dev/null &

bold "Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$p" ] && eval "$("$p" shellenv)"
  done
fi
if command -v brew >/dev/null 2>&1; then
  note "already installed"
else
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$p" ] && eval "$("$p" shellenv)"
  done
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew failed to install; nothing else can proceed." >&2
    echo "Scroll up for Homebrew's own error message. You can also install it by hand from https://brew.sh and re-run." >&2
    exit 1
  fi
  # Put brew on PATH for future terminal sessions.
  line="eval \"\$($(command -v brew) shellenv)\""
  grep -qsF "$line" "$HOME/.zprofile" || echo "$line" >> "$HOME/.zprofile"
fi
brew update --quiet || true

# ---------------------------------------------------------------- helpers
# brew_formula <formula> <label>
brew_formula() {
  if brew list --formula "$1" >/dev/null 2>&1; then
    skipped+=("$2"); note "$2 already installed"
  elif brew install "$1"; then
    ok+=("$2")
  else
    failed+=("$2")
  fi
}

# brew_cask <cask> <label> [path that means "already installed"]
brew_cask() {
  if brew list --cask "$1" >/dev/null 2>&1 || { [ -n "${3:-}" ] && [ -e "$3" ]; }; then
    skipped+=("$2"); note "$2 already installed"
  elif brew install --cask "$1"; then
    ok+=("$2")
  else
    failed+=("$2")
  fi
}

# ---------------------------------------------------------------- apps & CLIs
bold "Command-line tools";   brew_formula git "Git"
                             brew_formula "python@$PY_VERSION" "Python $PY_VERSION"
                             brew_formula uv "uv (Python package manager)"
                             brew_formula node "Node.js"
                             brew_formula opencode "opencode"

bold "Claude Code"
if command -v claude >/dev/null 2>&1; then
  skipped+=("Claude Code"); note "already installed"
elif curl -fsSL https://claude.ai/install.sh | bash; then
  ok+=("Claude Code")
else
  failed+=("Claude Code")
fi

bold "Desktop apps";  brew_cask visual-studio-code "VS Code"        "/Applications/Visual Studio Code.app"
                      brew_cask antigravity        "Antigravity"    "/Applications/Antigravity.app"
                      brew_cask github             "GitHub Desktop" "/Applications/GitHub Desktop.app"
                      brew_cask google-chrome      "Google Chrome"  "/Applications/Google Chrome.app"

# Make the `code` command available (the cask usually links it; this is a fallback).
if ! command -v code >/dev/null 2>&1 && [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
  ln -sf "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$(brew --prefix)/bin/code"
fi

# ---------------------------------------------------------------- python
bold "Python tools (uv tool install)"
if command -v uv >/dev/null 2>&1; then
  while read -r tool; do
    if uv tool list 2>/dev/null | grep -q "^$tool "; then
      note "$tool already installed"
    elif uv tool install --python "$PY_VERSION" "$tool" >/dev/null 2>&1; then
      note "installed $tool"
    else
      failed+=("python tool: $tool")
    fi
  done < <(read_list python-tools.txt)
  uv tool update-shell >/dev/null 2>&1 || true

  bold "Python starter environment ($VENV)"
  [ -d "$VENV" ] || uv venv --python "$PY_VERSION" "$VENV"
  # shellcheck disable=SC2046
  if uv pip install --python "$VENV/bin/python" $(read_list python-packages.txt); then
    ok+=("Python packages")
    "$VENV/bin/python" -m ipykernel install --user --name dev --display-name "Python (dev)" >/dev/null 2>&1 || true
  else
    failed+=("Python packages")
  fi
else
  failed+=("Python tools + packages (uv missing)")
fi

# ---------------------------------------------------------------- summary
bold "Done"
[ ${#ok[@]}      -gt 0 ] && printf '  \033[32m✓ installed:\033[0m %s\n' "$(IFS=,; echo "${ok[*]}" | sed 's/,/, /g')"
[ ${#skipped[@]} -gt 0 ] && printf '  • already had: %s\n' "$(IFS=,; echo "${skipped[*]}" | sed 's/,/, /g')"
[ ${#failed[@]}  -gt 0 ] && printf '  \033[31m✗ failed:\033[0m %s\n' "$(IFS=,; echo "${failed[*]}" | sed 's/,/, /g')"
cat <<EOF

Next steps
  1. Open a NEW terminal window so PATH changes take effect.
  2. Run \`claude\` and sign in. Run \`opencode\` to set up its provider.
  3. Open GitHub Desktop and sign in to GitHub.
  4. Use the Python environment:  source ~/.venvs/dev/bin/activate
     (or pick "Python (dev)" as the kernel in Jupyter / VS Code)
EOF
[ ${#failed[@]} -eq 0 ]
