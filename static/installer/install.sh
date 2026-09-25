#!/usr/bin/env bash
# Dev Starter Kit — macOS installer.
# Installs: Homebrew, Git, Node.js, Python, uv, Claude Code, opencode,
# VS Code, Antigravity, GitHub Desktop, Google Chrome, and Python dev packages.
#
# Homebrew WITHOUT the Xcode Command Line Tools: Homebrew's official installer
# insists on them, so this unpacks Homebrew directly and only ever installs
# prebuilt bottles and casks, which don't need a compiler. Anything Homebrew
# can't provide falls back to the vendor's own download.
#
# It checks its own work and re-runs until everything is really installed
# (up to MAX_ATTEMPTS passes). Safe to re-run by hand, too.
#
#   curl -fsSL https://www.eating.computer/installer/install.sh | bash

set -u
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
LIST_URL="https://www.eating.computer/installer"
PY_VERSION="3.13"
MAX_ATTEMPTS=5
VENV="$HOME/.venvs/dev"
BIN="$HOME/.local/bin"

case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
APPS="${DEVKIT_APPS:-/Applications}"   # DEVKIT_* overrides exist for testing

export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_INSTALL_CLEANUP=1

bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '    \033[33m%s\033[0m\n' "$*"; }
joined() { local IFS=,; echo "$*" | sed 's/,/, /g'; }

# Read a package list, ignoring comments and blank lines. Uses the copy next to
# this script when there is one, otherwise the published copy (curl | bash).
read_list() {
  if [ -f "$KIT_DIR/$1" ]; then cat "$KIT_DIR/$1"; else curl -fsSL "$LIST_URL/$1"; fi \
    | grep -vE '^[[:space:]]*(#|$)' | sed 's/[[:space:]]*$//'
}

have_app() {
  [ -e "$APPS/$1" ] && return 0
  [ -n "${DEVKIT_APPS:-}" ] && return 1   # tests: only look in the test folder
  [ -e "/Applications/$1" ] || [ -e "$HOME/Applications/$1" ]
}
have_cmd() { hash -r; command -v "$1" >/dev/null 2>&1 && "$1" --version >/dev/null 2>&1; }

# ================================================================ sudo
get_sudo() {
  [ -n "${DEVKIT_NO_SUDO:-}" ] && return 0
  bold "Administrator access"
  if ! id -Gn | tr ' ' '\n' | grep -qx admin; then
    echo "This Mac account ($USER) is not an Administrator, and the installer needs one." >&2
    echo "Make it an admin in System Settings → Users & Groups, then re-run." >&2
    exit 1
  fi
  note "Enter your Mac login password (nothing shows as you type):"
  sudo -v || { echo "Administrator access is required." >&2; exit 1; }
  # Keep the sudo ticket fresh for the whole run.
  while true; do sudo -n true; sleep 50; kill -0 "$$" || exit; done 2>/dev/null &
}
SUDO() { if [ -n "${DEVKIT_NO_SUDO:-}" ]; then "$@"; else sudo "$@"; fi; }

# ================================================================ homebrew
brew_env() {
  local p candidates=(/opt/homebrew/bin/brew /usr/local/bin/brew)
  [ -n "${DEVKIT_BREW_PREFIX:-}" ] && candidates=("$DEVKIT_BREW_PREFIX/bin/brew")  # tests: never touch a real brew
  for p in "${candidates[@]}"; do
    [ -x "$p" ] && { eval "$("$p" shellenv)"; return 0; }
  done
  return 1
}

install_brew() {
  command -v brew >/dev/null 2>&1 || brew_env
  if command -v brew >/dev/null 2>&1; then note "Homebrew already installed"; return 0; fi

  local prefix repo
  if [ -n "${DEVKIT_BREW_PREFIX:-}" ]; then prefix="$DEVKIT_BREW_PREFIX"; repo="$prefix"
  elif [ "$ARCH" = arm64 ];         then prefix=/opt/homebrew; repo=/opt/homebrew
  else                                   prefix=/usr/local;    repo=/usr/local/Homebrew
  fi
  note "unpacking Homebrew into $repo (no Xcode tools needed)"
  if [ "$repo" = "$prefix" ]; then
    SUDO mkdir -p "$prefix" && SUDO chown -R "$USER:admin" "$prefix"
  else
    local d
    for d in Homebrew bin etc include lib sbin share var opt Cellar Caskroom Frameworks; do
      SUDO mkdir -p "$prefix/$d" && SUDO chown -R "$USER:admin" "$prefix/$d"
    done
  fi || return 1
  curl -fsSL https://github.com/Homebrew/brew/tarball/main \
    | tar -xz --strip-components 1 -C "$repo" || return 1
  [ "$repo" != "$prefix" ] && ln -sf "$repo/bin/brew" "$prefix/bin/brew"
  eval "$("$prefix/bin/brew" shellenv)"
  brew --version >/dev/null   # first run fetches Homebrew's portable Ruby
}

# brew_or <fallback-fn> <brew args…> — try Homebrew, else the fallback.
brew_or() {
  local fallback="$1"; shift
  if command -v brew >/dev/null 2>&1 && brew install --quiet "$@"; then return 0; fi
  warn "Homebrew couldn't install $*; using the direct download instead"
  "$fallback"
}

# ================================================================ direct fallbacks
direct_app() { # direct_app <App.app> <url>
  local app="$1" url="$2" tmp; tmp="$(mktemp -d)"
  [ -n "$url" ] || return 1
  curl -fsSL "$url" -o "$tmp/dl" || { rm -rf "$tmp"; return 1; }
  if [ "$(head -c 2 "$tmp/dl")" = "PK" ]; then
    ditto -xk "$tmp/dl" "$tmp/x" && cp -R "$tmp/x/$app" "$APPS/"
  else
    hdiutil attach -nobrowse -quiet -mountpoint "$tmp/mnt" "$tmp/dl" && cp -R "$tmp/mnt/$app" "$APPS/"
    local rc=$?; hdiutil detach -quiet "$tmp/mnt" 2>/dev/null; [ $rc -eq 0 ]
  fi; local rc=$?
  rm -rf "$tmp"; return $rc
}
antigravity_url() {
  local j; j="$(mktemp)"
  curl -fsSL https://formulae.brew.sh/api/cask/antigravity.json -o "$j" &&
    plutil -extract url raw -o - "$j" 2>/dev/null |
    { if [ "$ARCH" = x64 ]; then sed 's#/darwin-arm/#/darwin-x64/#'; else cat; fi; }
  rm -f "$j"
}
fb_vscode()  { direct_app "Visual Studio Code.app" "https://update.code.visualstudio.com/latest/darwin-universal/stable"; }
fb_chrome()  { direct_app "Google Chrome.app" "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg"; }
fb_ghd()     { direct_app "GitHub Desktop.app" "https://central.github.com/deployments/desktop/desktop/latest/darwin$([ "$ARCH" = arm64 ] && echo -arm64)"; }
fb_antigrav(){ direct_app "Antigravity.app" "$(antigravity_url)"; }
fb_uv()      { curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null; }
fb_python()  { have_cmd uv || fb_uv; uv python install "$PY_VERSION" --default 2>/dev/null || uv python install "$PY_VERSION"; }
fb_opencode(){ curl -fsSL https://opencode.ai/install | bash >/dev/null; }
fb_node() {
  local line=latest-v24.x tarball tmp; tmp="$(mktemp -d)"
  tarball=$(curl -fsSL "https://nodejs.org/dist/$line/SHASUMS256.txt" | awk "/darwin-$ARCH\\.tar\\.gz\$/ {print \$2}")
  [ -n "$tarball" ] && curl -fsSL "https://nodejs.org/dist/$line/$tarball" -o "$tmp/node.tgz" &&
    mkdir -p "$HOME/.local/node" && tar -xzf "$tmp/node.tgz" -C "$HOME/.local/node" --strip-components 1
  local rc=$?; rm -rf "$tmp"; return $rc
}
fb_git() { # the real git bundled inside GitHub Desktop, behind a wrapper
  local g
  for g in "$APPS" /Applications "$HOME/Applications"; do
    [ -n "${DEVKIT_APPS:-}" ] && [ "$g" != "$APPS" ] && continue
    g="$g/GitHub Desktop.app/Contents/Resources/app/git"
    [ -x "$g/bin/git" ] || continue
    cat > "$BIN/git" <<EOF
#!/bin/sh
# git, borrowed from GitHub Desktop (Dev Starter Kit fallback).
G="$g"
export GIT_EXEC_PATH="\$G/libexec/git-core" GIT_TEMPLATE_DIR="\$G/share/git-core/templates"
exec "\$G/bin/git" "\$@"
EOF
    chmod +x "$BIN/git"; return 0
  done
  return 1
}

# ================================================================ one pass
app() { # app <label> <App.app> <cask> <fallback-fn>
  have_app "$2" && return 0
  note "installing $1…"
  brew_or "$4" --cask --appdir="$APPS" "$3"
}
cli() { # cli <label> <command> <formula> <fallback-fn>
  have_cmd "$2" && return 0
  note "installing $1…"
  brew_or "$4" "$3"
}

install_pass() {
  bold "Homebrew";  install_brew || warn "Homebrew didn't install this pass"

  bold "Command-line tools"
  cli "Git"       git      git            fb_git
  cli "Node.js"   node     node           fb_node
  cli "uv"        uv       uv             fb_uv
  cli "Python $PY_VERSION" "python$PY_VERSION" "python@$PY_VERSION" fb_python
  cli "opencode"  opencode opencode       fb_opencode
  if ! have_cmd claude; then
    note "installing Claude Code…"; curl -fsSL https://claude.ai/install.sh | bash
  fi

  bold "Desktop apps"
  app "VS Code"        "Visual Studio Code.app" visual-studio-code fb_vscode
  app "Google Chrome"  "Google Chrome.app"      google-chrome      fb_chrome
  app "GitHub Desktop" "GitHub Desktop.app"     github             fb_ghd
  app "Antigravity"    "Antigravity.app"        antigravity        fb_antigrav
  local vsc="$APPS/Visual Studio Code.app/Contents/Resources/app/bin/code"
  have_cmd code || { [ -x "$vsc" ] && ln -sf "$vsc" "$BIN/code"; }
  have_cmd git || fb_git   # git may only be possible once GitHub Desktop exists

  if have_cmd uv; then
    bold "Python tools"
    local tool
    while read -r tool; do
      uv tool list 2>/dev/null | grep -q "^$tool " && continue
      uv tool install -q --python "$PY_VERSION" "$tool" >/dev/null 2>&1 && note "installed $tool"
    done < <(read_list python-tools.txt)

    bold "Python starter environment ($VENV)"
    local pkgs; pkgs="$(read_list python-packages.txt | tr '\n' ' ')"
    if [ "$(cat "$VENV/.devkit" 2>/dev/null)" != "$pkgs" ]; then
      [ -x "$VENV/bin/python" ] || uv venv -q --python "$PY_VERSION" "$VENV"
      # shellcheck disable=SC2086
      uv pip install -q --python "$VENV/bin/python" $pkgs && echo "$pkgs" > "$VENV/.devkit" &&
        "$VENV/bin/python" -m ipykernel install --user --name dev --display-name "Python (dev)" >/dev/null 2>&1
    fi
    note "ready"
  fi
}

# ================================================================ verify
# Fills MISSING with everything that isn't really there yet.
verify() {
  MISSING=()
  have_cmd brew     || MISSING+=("Homebrew")
  have_cmd git      || MISSING+=("Git")
  have_cmd node     || MISSING+=("Node.js")
  have_cmd npm      || MISSING+=("npm")
  have_cmd uv       || MISSING+=("uv")
  have_cmd "python$PY_VERSION" || uv python find "$PY_VERSION" >/dev/null 2>&1 || MISSING+=("Python $PY_VERSION")
  have_cmd claude   || MISSING+=("Claude Code")
  have_cmd opencode || MISSING+=("opencode")
  have_app "Visual Studio Code.app" || MISSING+=("VS Code")
  have_app "Google Chrome.app"      || MISSING+=("Google Chrome")
  have_app "GitHub Desktop.app"     || MISSING+=("GitHub Desktop")
  have_app "Antigravity.app"        || MISSING+=("Antigravity")
  local tool
  while read -r tool; do
    uv tool list 2>/dev/null | grep -q "^$tool " || MISSING+=("python tool: $tool")
  done < <(read_list python-tools.txt)
  [ "$(cat "$VENV/.devkit" 2>/dev/null)" = "$(read_list python-packages.txt | tr '\n' ' ')" ] ||
    MISSING+=("Python packages")
}

persist_path() {
  local marker="# Dev Starter Kit" rc brewline=""
  command -v brew >/dev/null 2>&1 && brewline="eval \"\$($(command -v brew) shellenv)\""
  for rc in "$HOME/.zprofile" "$HOME/.bash_profile"; do
    grep -qsF "$marker" "$rc" && continue
    { printf '\n%s\n' "$marker"
      [ -n "$brewline" ] && echo "$brewline"
      echo 'export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$HOME/.opencode/bin:$PATH"'
    } >> "$rc"
  done
}

# ================================================================ main
main() {
  # Under `curl | bash` stdin IS this script; don't let any installer eat it.
  exec </dev/null
  mkdir -p "$BIN" "$APPS" 2>/dev/null
  export PATH="$BIN:$HOME/.local/node/bin:$HOME/.opencode/bin:$PATH"
  brew_env || true

  get_sudo

  local attempt
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    [ "$attempt" -gt 1 ] && bold "Pass $attempt of $MAX_ATTEMPTS — retrying: $(joined "${MISSING[@]}")"
    install_pass
    persist_path
    verify
    [ ${#MISSING[@]} -eq 0 ] && break
    [ "$attempt" -lt "$MAX_ATTEMPTS" ] && { warn "Still missing: $(joined "${MISSING[@]}") — checking again in 10s"; sleep 10; }
  done

  bold "Done"
  if [ ${#MISSING[@]} -eq 0 ]; then
    printf '  \033[32m✓ Everything is installed.\033[0m\n'
  else
    printf '  \033[31m✗ Still missing after %s passes:\033[0m %s\n' "$MAX_ATTEMPTS" "$(joined "${MISSING[@]}")"
    echo "  Scroll up for the errors, or run the command again later."
  fi
  cat <<EOF

Next steps
  1. Open a NEW terminal window so PATH changes take effect.
  2. Run \`claude\` and sign in. Run \`opencode\` to set up its provider.
  3. Open GitHub Desktop and sign in to GitHub.
  4. Use the Python environment:  source ~/.venvs/dev/bin/activate
     (or pick "Python (dev)" as the kernel in Jupyter / VS Code)
EOF
  [ ${#MISSING[@]} -eq 0 ]
}

main "$@"; exit $?
