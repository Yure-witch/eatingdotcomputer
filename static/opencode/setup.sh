#!/usr/bin/env bash
# Point opencode at Cooper's Gemma (chatterbox.ee.cooper.edu).
#
#   curl -fsSL https://www.eating.computer/opencode/setup.sh | bash
#
# Asks for your chatterbox API key, saves it to ~/.config/opencode/cooper-key
# (readable only by you), and writes an opencode.json that uses it. An existing
# opencode.json is backed up first. Safe to re-run — use it to change your key.
set -euo pipefail

BASE="https://chatterbox.ee.cooper.edu/api/v1"
FALLBACK_MODEL="nvidia/Gemma-4-26B-A4B-NVFP4"
DIR="$HOME/.config/opencode"
KEYFILE="$DIR/cooper-key"
CONFIG="$DIR/opencode.json"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if ! command -v opencode >/dev/null 2>&1 && [ ! -x "$HOME/.opencode/bin/opencode" ]; then
  echo "opencode isn't installed yet. Install it first:"
  echo "  curl -fsSL https://opencode.ai/install | bash"
  exit 1
fi

bold "Your chatterbox API key"
echo "Get it at https://chatterbox.ee.cooper.edu → your name (bottom-left) → Settings → Account → API keys → Show."
KEY="${COOPER_KEY:-}"   # non-interactive: COOPER_KEY=sk-… bash setup.sh
while [ -z "$KEY" ]; do
  printf 'Paste it here (it will not show) and press Return: '
  IFS= read -rs KEY < /dev/tty || true
  echo
  KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
done

bold "Checking the key"
MODELS="$(curl -s -m 20 -w '\n%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/models" || true)"
CODE="$(printf '%s' "$MODELS" | tail -n1)"
case "$CODE" in
  200) echo "Key works." ;;
  401|403) echo "chatterbox rejected that key. Copy it again and re-run this script."; exit 1 ;;
  *) echo "Couldn't reach chatterbox (HTTP ${CODE:-none}). Saving the key anyway — try again later." ;;
esac

# The service exposes one model and its id has changed before, so ask for it.
MODEL="$(printf '%s' "$MODELS" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
MODEL="${MODEL:-$FALLBACK_MODEL}"
echo "Model: $MODEL"

mkdir -p "$DIR"
( umask 077; printf '%s' "$KEY" > "$KEYFILE" )
chmod 600 "$KEYFILE"

if [ -f "$CONFIG" ]; then
  BACKUP="$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$CONFIG" "$BACKUP"
  echo "Backed up your old config to $BACKUP"
fi

# enable_thinking:false matters: without it this deployment can reason in
# circles until it runs out of tokens and answers nothing.
cat > "$CONFIG" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "cooper": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cooper Chatterbox",
      "options": {
        "baseURL": "$BASE",
        "apiKey": "{file:~/.config/opencode/cooper-key}"
      },
      "models": {
        "$MODEL": {
          "name": "Gemma",
          "options": {
            "extraBody": {
              "chat_template_kwargs": { "enable_thinking": false }
            }
          }
        }
      }
    }
  },
  "model": "cooper/$MODEL"
}
JSON

bold "Done"
echo "Open a new Terminal window, cd into a project folder, and run: opencode"
