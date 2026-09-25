#!/usr/bin/env bash
# Dev Starter Kit — macOS installer.
# Installs: Claude Code, VS Code, Antigravity, GitHub Desktop, Google Chrome,
# Git, Node.js, Python, uv, opencode, and a set of Python dev packages.
#
# No Homebrew, no Xcode Command Line Tools, no password: every app comes from
# its vendor's own download, and command-line tools go in ~/.local.
# Safe to re-run: anything already installed is skipped.
#
# Run from the unzipped kit, or straight from the web:
#   curl -fsSL https://www.eating.computer/installer/install.sh | bash

set -u
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
LIST_URL="https://www.eating.computer/installer"
PY_VERSION="3.13"
NODE_LINE="latest-v24.x"   # current Node LTS line
VENV="$HOME/.venvs/dev"
BIN="$HOME/.local/bin"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
# Admins can write /Applications without sudo; anyone else gets ~/Applications.
APPS="${DEVKIT_APPS:-/Applications}"; [ -w "$APPS" ] || { APPS="$HOME/Applications"; mkdir -p "$APPS"; }

mkdir -p "$BIN"
export PATH="$BIN:$HOME/.local/node/bin:$HOME/.opencode/bin:$PATH"

ok=(); skipped=(); failed=()
bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
joined() { local IFS=,; echo "$*" | sed 's/,/, /g'; }

# Read a package list, ignoring comments and blank lines. Uses the copy next to
# this script when there is one, otherwise the published copy (curl | bash).
read_list() {
  if [ -f "$KIT_DIR/$1" ]; then cat "$KIT_DIR/$1"; else curl -fsSL "$LIST_URL/$1"; fi \
    | grep -vE '^[[:space:]]*(#|$)' | sed 's/[[:space:]]*$//'
}

# ---------------------------------------------------------------- desktop apps
# install_app <App Name.app> <url> — handles .dmg and .zip. Runs in the
# background; writes "ok" or "failed" to $TMP/<name>.status.
install_app() {
  local app="$1" url="$2" name="${1%.app}" file
  local log="$TMP/$name.log" status="$TMP/$name.status"
  {
    file="$TMP/$name.download"
    curl -fsSL "$url" -o "$file" || { echo failed > "$status"; return; }
    if [ "$(head -c 2 "$file")" = "PK" ]; then           # zip
      ditto -xk "$file" "$TMP/$name.unzip" && cp -R "$TMP/$name.unzip/$app" "$APPS/"
    else                                                  # dmg
      local mnt="$TMP/$name.mnt"
      hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$file" \
        && cp -R "$mnt/$app" "$APPS/"; local rc=$?
      hdiutil detach -quiet "$mnt" 2>/dev/null
      [ $rc -eq 0 ]
    fi && echo ok > "$status" || echo failed > "$status"
  } >"$log" 2>&1
}

# Antigravity has no stable "latest" link; Homebrew's public cask API tracks it
# (read over HTTP — Homebrew itself is not needed).
antigravity_url() {
  curl -fsSL https://formulae.brew.sh/api/cask/antigravity.json -o "$TMP/ag.json" &&
    plutil -extract url raw -o - "$TMP/ag.json" |
    { if [ "$ARCH" = x64 ]; then sed 's#/darwin-arm/#/darwin-x64/#'; else cat; fi; }
}

bold "Desktop apps (downloading in parallel)"
pending=()
queue_app() { # queue_app <label> <App.app> <url>
  if [ -e "$APPS/$2" ] || [ -e "$HOME/Applications/$2" ]; then
    skipped+=("$1"); note "$1 already installed"
  elif [ -z "$3" ]; then
    failed+=("$1"); note "$1: couldn't find a download link"
  else
    install_app "$2" "$3" & pending+=("$1|$2")
    note "downloading $1…"
  fi
}
queue_app "VS Code"        "Visual Studio Code.app" "https://update.code.visualstudio.com/latest/darwin-universal/stable"
queue_app "Google Chrome"  "Google Chrome.app"      "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg"
queue_app "GitHub Desktop" "GitHub Desktop.app"     "https://central.github.com/deployments/desktop/desktop/latest/darwin$([ "$ARCH" = arm64 ] && echo -arm64)"
queue_app "Antigravity"    "Antigravity.app"        "$(antigravity_url)"

# ---------------------------------------------------------------- CLIs (meanwhile)
bold "Claude Code"
if command -v claude >/dev/null 2>&1; then
  skipped+=("Claude Code"); note "already installed"
elif curl -fsSL https://claude.ai/install.sh | bash; then
  ok+=("Claude Code")
else
  failed+=("Claude Code")
fi

bold "uv + Python $PY_VERSION"
if command -v uv >/dev/null 2>&1; then
  skipped+=("uv"); note "uv already installed"
elif curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null; then
  ok+=("uv")
else
  failed+=("uv")
fi
if command -v uv >/dev/null 2>&1; then
  if uv python install "$PY_VERSION" --default 2>/dev/null || uv python install "$PY_VERSION"; then
    ok+=("Python $PY_VERSION")
  else
    failed+=("Python $PY_VERSION")
  fi
fi

bold "Node.js"
if [ -x "$HOME/.local/node/bin/node" ]; then
  skipped+=("Node.js"); note "already installed"
else
  tarball=$(curl -fsSL "https://nodejs.org/dist/$NODE_LINE/SHASUMS256.txt" | awk "/darwin-$ARCH\\.tar\\.gz\$/ {print \$2}")
  if [ -n "$tarball" ] && curl -fsSL "https://nodejs.org/dist/$NODE_LINE/$tarball" -o "$TMP/node.tgz" \
     && mkdir -p "$HOME/.local/node" && tar -xzf "$TMP/node.tgz" -C "$HOME/.local/node" --strip-components 1; then
    ok+=("Node.js $("$HOME/.local/node/bin/node" --version)")
  else
    failed+=("Node.js")
  fi
fi

bold "opencode"
if command -v opencode >/dev/null 2>&1; then
  skipped+=("opencode"); note "already installed"
elif curl -fsSL https://opencode.ai/install | bash >/dev/null; then
  ok+=("opencode")
else
  failed+=("opencode")
fi

# ---------------------------------------------------------------- python packages
if command -v uv >/dev/null 2>&1; then
  bold "Python tools (uv tool install)"
  while read -r tool; do
    if uv tool list 2>/dev/null | grep -q "^$tool "; then
      note "$tool already installed"
    elif uv tool install --python "$PY_VERSION" "$tool" >/dev/null 2>&1; then
      note "installed $tool"
    else
      failed+=("python tool: $tool")
    fi
  done < <(read_list python-tools.txt)

  bold "Python starter environment ($VENV)"
  [ -d "$VENV" ] || uv venv -q --python "$PY_VERSION" "$VENV"
  # shellcheck disable=SC2046
  if uv pip install -q --python "$VENV/bin/python" $(read_list python-packages.txt); then
    ok+=("Python packages")
    "$VENV/bin/python" -m ipykernel install --user --name dev --display-name "Python (dev)" >/dev/null 2>&1 || true
  else
    failed+=("Python packages")
  fi
fi

# ---------------------------------------------------------------- wait for apps
bold "Finishing desktop apps"
wait
for entry in ${pending[@]+"${pending[@]}"}; do
  label="${entry%%|*}"; app="${entry#*|}"; name="${app%.app}"
  if [ "$(cat "$TMP/$name.status" 2>/dev/null)" = ok ]; then
    ok+=("$label")
  else
    failed+=("$label"); note "$label failed:"; sed 's/^/      /' "$TMP/$name.log" | tail -5
  fi
done

# ---------------------------------------------------------------- git + code
# Real git ships with GitHub Desktop; expose it on the command line so macOS's
# /usr/bin/git stub (which demands the Xcode tools) never gets hit.
GHD_GIT="$APPS/GitHub Desktop.app/Contents/Resources/app/git"
[ -d "$GHD_GIT" ] || GHD_GIT="$HOME/Applications/GitHub Desktop.app/Contents/Resources/app/git"
if [ -x "$GHD_GIT/bin/git" ]; then
  cat > "$BIN/git" <<EOF
#!/bin/sh
# git, borrowed from GitHub Desktop (see Dev Starter Kit).
G="$GHD_GIT"
export GIT_EXEC_PATH="\$G/libexec/git-core" GIT_TEMPLATE_DIR="\$G/share/git-core/templates"
exec "\$G/bin/git" "\$@"
EOF
  chmod +x "$BIN/git"
  ok+=("Git $("$BIN/git" --version | awk '{print $3}')")
else
  failed+=("Git (needs GitHub Desktop)")
fi

VSC_BIN="$APPS/Visual Studio Code.app/Contents/Resources/app/bin/code"
[ -x "$VSC_BIN" ] && ln -sf "$VSC_BIN" "$BIN/code"

# ---------------------------------------------------------------- PATH
marker="# Dev Starter Kit"
for rc in "$HOME/.zprofile" "$HOME/.bash_profile"; do
  grep -qsF "$marker" "$rc" || printf '\n%s\nexport PATH="$HOME/.local/bin:$HOME/.local/node/bin:$HOME/.opencode/bin:$PATH"\n' "$marker" >> "$rc"
done

# ---------------------------------------------------------------- summary
bold "Done"
[ ${#ok[@]}      -gt 0 ] && printf '  \033[32m✓ installed:\033[0m %s\n' "$(joined "${ok[@]}")"
[ ${#skipped[@]} -gt 0 ] && printf '  • already had: %s\n' "$(joined "${skipped[@]}")"
[ ${#failed[@]}  -gt 0 ] && printf '  \033[31m✗ failed:\033[0m %s\n' "$(joined "${failed[@]}")"
cat <<EOF

Next steps
  1. Open a NEW terminal window so PATH changes take effect.
  2. Run \`claude\` and sign in. Run \`opencode\` to set up its provider.
  3. Open GitHub Desktop and sign in to GitHub.
  4. Use the Python environment:  source ~/.venvs/dev/bin/activate
     (or pick "Python (dev)" as the kernel in Jupyter / VS Code)
EOF
[ ${#failed[@]} -eq 0 ]
