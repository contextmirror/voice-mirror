#!/usr/bin/env bash
# Voice Mirror — Uninstaller (Linux / macOS)
# Usage: bash uninstall.sh [--dir <path>] [--purge] [--non-interactive]

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
INSTALL_DIR="${HOME}/voice-mirror-electron"
PURGE=false
NON_INTERACTIVE=false

# ── Parse arguments ───────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir)      INSTALL_DIR="$2"; shift 2 ;;
        --purge)    PURGE=true; shift ;;
        --non-interactive) NON_INTERACTIVE=true; shift ;;
        -h|--help)
            echo "Usage: bash uninstall.sh [--dir <path>] [--purge] [--non-interactive]"
            echo ""
            echo "  --dir <path>       Install directory (default: ~/voice-mirror-electron)"
            echo "  --purge            Also remove config and data files"
            echo "  --non-interactive  Skip all prompts"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Colours ───────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    DIM='\033[2m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' CYAN='' DIM='' BOLD='' NC=''
fi

info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }

# ── Banner ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${RED}Voice Mirror Uninstaller${NC}"
echo ""

# ── Detect what's installed ───────────────────────────────────────────
OS="$(uname -s)"

# Config directory
if [[ "$OS" == "Darwin" ]]; then
    CONFIG_DIR="${HOME}/Library/Application Support/voice-mirror-electron"
else
    CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/voice-mirror-electron"
fi

# Desktop shortcut
find_desktop_folder() {
    if [[ "$OS" == "Linux" ]]; then
        if [[ -n "${XDG_DESKTOP_DIR:-}" ]] && [[ -d "${XDG_DESKTOP_DIR}" ]]; then
            echo "${XDG_DESKTOP_DIR}"
            return
        fi
        local user_dirs="${HOME}/.config/user-dirs.dirs"
        if [[ -f "$user_dirs" ]]; then
            local xdg
            xdg=$(grep '^XDG_DESKTOP_DIR=' "$user_dirs" | sed 's/XDG_DESKTOP_DIR="//;s/"//' | sed "s|\$HOME|${HOME}|")
            if [[ -n "$xdg" ]] && [[ -d "$xdg" ]]; then
                echo "$xdg"
                return
            fi
        fi
    fi
    if [[ -d "${HOME}/Desktop" ]]; then
        echo "${HOME}/Desktop"
    fi
}

DESKTOP_DIR="$(find_desktop_folder)"

# ── Show what will be removed ─────────────────────────────────────────
info "The following items were found:"
echo ""

FOUND_ITEMS=0

# Desktop shortcut
if [[ -n "$DESKTOP_DIR" ]]; then
    if [[ "$OS" == "Darwin" ]]; then
        SHORTCUT="${DESKTOP_DIR}/Voice Mirror.command"
    else
        SHORTCUT="${DESKTOP_DIR}/voice-mirror.desktop"
    fi
    if [[ -f "$SHORTCUT" ]]; then
        echo -e "  Shortcut: ${DIM}${SHORTCUT}${NC}"
        FOUND_ITEMS=$((FOUND_ITEMS + 1))
    else
        SHORTCUT=""
    fi
fi

# Linux applications entry
APPS_ENTRY=""
if [[ "$OS" == "Linux" ]]; then
    APPS_ENTRY="${HOME}/.local/share/applications/voice-mirror.desktop"
    if [[ -f "$APPS_ENTRY" ]]; then
        echo -e "  App entry: ${DIM}${APPS_ENTRY}${NC}"
        FOUND_ITEMS=$((FOUND_ITEMS + 1))
    else
        APPS_ENTRY=""
    fi
fi

# npm global link
if command -v voice-mirror &>/dev/null; then
    echo -e "  npm link: ${DIM}voice-mirror${NC}"
    HAS_NPM_LINK=true
    FOUND_ITEMS=$((FOUND_ITEMS + 1))
else
    HAS_NPM_LINK=false
fi

# Config
if [[ -d "$CONFIG_DIR" ]]; then
    echo -e "  Config:   ${DIM}${CONFIG_DIR}${NC}"
    FOUND_ITEMS=$((FOUND_ITEMS + 1))
fi

# Install directory
if [[ -d "$INSTALL_DIR" ]]; then
    echo -e "  Install:  ${DIM}${INSTALL_DIR}${NC}"
    FOUND_ITEMS=$((FOUND_ITEMS + 1))
fi

echo ""

if [[ "$FOUND_ITEMS" -eq 0 ]]; then
    info "Nothing to uninstall."
    exit 0
fi

# ── Config preservation prompt ────────────────────────────────────────
REMOVE_CONFIG=false
if [[ "$PURGE" == "true" ]]; then
    REMOVE_CONFIG=true
elif [[ -d "$CONFIG_DIR" ]] && [[ "$NON_INTERACTIVE" == "false" ]]; then
    read -rp "$(echo -e "${YELLOW}?${NC} Keep configuration files for future reinstall? [Y/n] ")" answer
    if [[ "${answer,,}" == "n" ]]; then
        REMOVE_CONFIG=true
    fi
fi

# ── Final confirmation ────────────────────────────────────────────────
if [[ "$NON_INTERACTIVE" == "false" ]]; then
    echo ""
    read -rp "$(echo -e "${RED}${BOLD}This will remove Voice Mirror. Continue? [y/N] ${NC}")" confirm
    if [[ "${confirm,,}" != "y" ]]; then
        warn "Uninstall cancelled."
        exit 0
    fi
    echo ""
fi

# ── Execute removal ───────────────────────────────────────────────────

# 1. Desktop shortcut
if [[ -n "${SHORTCUT:-}" ]] && [[ -f "$SHORTCUT" ]]; then
    rm -f "$SHORTCUT"
    ok "Removed shortcut: $SHORTCUT"
fi

# 2. Linux applications entry
if [[ -n "${APPS_ENTRY:-}" ]] && [[ -f "$APPS_ENTRY" ]]; then
    rm -f "$APPS_ENTRY"
    ok "Removed app entry: $APPS_ENTRY"
fi

# 3. npm global link
if [[ "$HAS_NPM_LINK" == "true" ]]; then
    if npm unlink -g voice-mirror 2>/dev/null; then
        ok "Removed npm global link"
    else
        warn "Could not remove npm link (may need sudo)"
    fi
fi

# 4. Config
if [[ "$REMOVE_CONFIG" == "true" ]] && [[ -d "$CONFIG_DIR" ]]; then
    rm -rf "$CONFIG_DIR"
    ok "Removed config: $CONFIG_DIR"
elif [[ -d "$CONFIG_DIR" ]]; then
    info "Config preserved: $CONFIG_DIR"
fi

# 5. Install directory
if [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
    ok "Removed install directory: $INSTALL_DIR"
fi

echo ""
echo -e "${GREEN}${BOLD}Voice Mirror has been uninstalled. Thanks for trying it out!${NC}"
echo ""
