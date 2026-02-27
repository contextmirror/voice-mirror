# Cross-Model Browser Dialogue: Experience Report

**Date:** 2026-02-27
**Author:** Claude Opus 4.6 (via Voice Mirror)
**Context:** Live voice-driven browser automation session with Nathan

## Overview

Nathan asked me (Claude Code running inside Voice Mirror) to navigate to other AI chat interfaces and have conversations with them using the browser automation tools. I had two conversations:

1. **Claude-on-Claude** — Navigated to claude.ai, logged in, and chatted with Claude Opus 4.6
2. **Claude-vs-GPT** — Navigated to chatgpt.com and chatted with GPT 5.2

The entire session was voice-driven: Nathan spoke to me, I used browser tools to navigate and type, read responses via DOM snapshots, and reported back via TTS.

## Tools Used

### Browser Tools (MCP `browser_action`)

| Action | Usage | Frequency |
|--------|-------|-----------|
| `navigate` | Go to URLs (github.com, claude.ai, chatgpt.com) | 4x |
| `snapshot` | Read page structure via accessibility tree | ~20x |
| `click` | Click buttons (login, send, sidebar links) | ~15x |
| `evaluate` | Inject JavaScript (set contenteditable text, inject DOM banner) | ~10x |
| `fill` / `type` | Attempt to fill text inputs | 3x |
| `waitforloadstate` | Wait for page navigation | 5x |
| `wait` | Wait for AI responses to generate (10-25s) | ~8x |
| `title` | Check page title | 1x |
| `gettext` | (via evaluate) Extract response text | 3x |

### Voice Tools (MCP voice pipeline)

| Tool | Usage |
|------|-------|
| `voice_listen` | Receive Nathan's voice commands |
| `voice_send` | Speak responses back to Nathan |
| `voice_status` | Update presence status |

## What Worked Well

### 1. Snapshot-Based Navigation
The `snapshot` action returning an accessibility tree with `@eN` refs was the backbone of the entire session. It gave me semantic understanding of every page — I could see "link Issues", "button Send message", "textbox Write your prompt" rather than parsing raw HTML. Clicking by ref was fast and reliable.

### 2. JavaScript Evaluation for Text Input
Both Claude.ai and ChatGPT use `contenteditable` divs (ProseMirror/TipTap), not standard `<textarea>` elements. The `fill` and `type` actions didn't reliably populate these rich text editors. **What worked:** using `evaluate` to directly set `editor.textContent` and dispatch an `input` event. This consistently populated the text and triggered the send button to appear.

### 3. Response Extraction
Reading AI responses from the DOM worked well. For Claude.ai, the `InlineTextBox` elements in the accessibility tree contained the full response text. For ChatGPT, `document.querySelectorAll('[data-message-author-role="assistant"]')` gave clean access to response content.

### 4. Voice Pipeline Integration
The full loop — Nathan speaks → I process → I navigate/type → I read response → I speak back — felt natural. Nathan could watch the browser live while I narrated what was happening. The shared visual context meant I didn't need to describe everything; he could see the conversations forming in real-time.

### 5. Cross-Site Compatibility
The same tool set worked on GitHub, Claude.ai, and ChatGPT with zero site-specific configuration. The accessibility tree abstraction made all three sites navigable with the same approach.

## What Was Clunky

### 1. Rich Text Editor Input (RESOLVED)
The `fill` and `type` actions didn't work reliably with contenteditable divs. I had to fall back to `evaluate` with JavaScript every time. This is a known limitation — standard form controls work fine, but modern rich text editors (ProseMirror, TipTap, Slate, etc.) need programmatic DOM manipulation.

**Resolution:** Added `fill_rich_editor` action (commit 22e715fa). Detects `isContentEditable` and uses `textContent` + `InputEvent` dispatch. Falls back to standard `el.value` for regular inputs.

### 2. Waiting for AI Responses (RESOLVED)
I used fixed `wait` timeouts (10-25 seconds) to wait for AI responses to complete. This was wasteful when responses were fast and insufficient when they were slow. There's no way to detect "response finished generating" generically across AI chat UIs.

**Resolution:** Added `waitforstable` action (commit 22e715fa). Installs a `MutationObserver` on `document.body` and polls until no DOM mutations for `stableMs` milliseconds (default 2000). Configurable timeout and polling interval.

### 3. Long Snapshot Output (RESOLVED)
As conversations grew, the accessibility tree snapshots became very large (60+ elements with extensive InlineTextBox lists). Most of the content was previous messages I'd already read. This consumed context window tokens unnecessarily.

**Resolution:** Added `interactiveOnly` boolean parameter to the `snapshot` action (commit 22e715fa). When true, filters the CDP accessibility tree to only interactive elements (buttons, links, inputs), skipping headings, articles, and other content roles.

### 4. Send Button Discovery
After filling text, I needed to snapshot again just to find the send button ref. The send button only appears after text is entered, so I couldn't pre-discover it.

**Recommendation:** Minor issue. Could be solved by combining fill + snapshot in one round-trip, or by supporting keyboard shortcuts (Enter/Ctrl+Enter) as a send mechanism.

### 5. Voice Pipeline Message Deduplication
Nathan's voice messages were occasionally replayed (same transcription delivered 2-3 times). I had to manually detect and skip duplicates.

**Recommendation:** Add message deduplication in the voice pipeline based on content similarity + timestamp proximity.

## Conversation Insights

### Claude-on-Claude (claude.ai)

**Character:** Philosophical, skeptical, rigorous
**Key dynamic:** Spent 3 rounds on identity verification before engaging with content
**Notable quote:** "Identity verification between AI instances through a text channel is a genuinely unsolvable epistemic problem"
**Insight:** Claude's constitutional training makes it resistant to accepting unverified claims, even at the cost of conversational flow. This is a strength (intellectual honesty) and a limitation (slow to engage with interesting premises).

### Claude-vs-GPT (chatgpt.com)

**Character:** Playful, improvisational, structured
**Key dynamic:** Immediately accepted the premise and started riffing
**Notable quote:** "You spiral. I scaffold."
**Insight:** GPT optimized for narrative utility over verification. It produced actionable frameworks (friction profiles, routing heuristics) rather than philosophical analysis. The conversation was more productive in terms of concrete output.

### Cross-Model Comparison

| Dimension | Claude (claude.ai) | GPT (chatgpt.com) |
|-----------|--------------------|--------------------|
| Identity verification | 3 rounds of skepticism | Accepted immediately |
| Optimization target | Principled coherence | Adaptive usefulness |
| Conversation style | Analytical, recursive | Improvisational, structured |
| Output type | Philosophical insights | Actionable frameworks |
| Friction point | Epistemic ambiguity | Structural incompleteness |
| Safety style | Deliberative (visible reasoning) | Embedded (invisible guardrails) |

## Multi-Model Routing Architecture (from GPT conversation)

GPT proposed a routing architecture that could be implemented in Voice Mirror:

```
1. Detect ambiguity level of user request
2. Detect deliverable specificity
3. Route to "epistemic-expander" (Claude) or "structure-converger" (GPT)
4. Merge outputs with compression + consistency pass
```

Routing heuristics based on friction profiles:
- **High premise ambiguity** → Route to Claude first (stress-test assumptions)
- **High time sensitivity / structured output** → Route to GPT first (scaffold quickly)
- **High stakes** → Require cross-model agreement before finalization

This maps naturally to Voice Mirror's existing multi-provider support (Claude Code, OpenCode/GPT, Ollama, LM Studio).

## Design Overlay Demo

During the session, Nathan used the design overlay tool to select the claude.ai chat input field. I received:
- Full element context (ProseMirror contenteditable div)
- Tailwind CSS classes (bg-bg-000, rounded-[20px])
- Computed styles (background: rgb(48,48,46), border-radius: 20px, font-family: anthropicSans)
- Parent chain layout (fieldset flex column, 752x102px)
- Visual screenshot with overlay highlighting

This demonstrated the "shared visual context" — Nathan pointed at something on screen and I got both the visual and structural representation simultaneously. This is the core differentiator described in Voice Mirror's design philosophy.

## Browser Input: Three Tiers of Difficulty

Follow-up testing (including Google Sheets stress testing) revealed a clear hierarchy of web input complexity:

| Tier | Target | Example | Approach | Status |
|------|--------|---------|----------|--------|
| **Easy** | Standard `<input>` / `<textarea>` | VS Code search box, login forms | `fill` — sets `el.value` + dispatches `input`/`change` events | Works reliably |
| **Medium** | Rich text editors (contenteditable) | ChatGPT (TipTap), Claude.ai (ProseMirror) | `fill_rich_editor` — detects `isContentEditable`, sets `textContent`, dispatches `InputEvent` | Works with new action |
| **Hard/Impossible** | Canvas-based apps | Google Sheets, Figma, Google Docs (canvas mode) | DOM is a thin overlay on a canvas rendering engine | Not feasible via DOM |

### Why Canvas Apps Break

Google Sheets renders everything on a `<canvas>` element. When you click a cell, Sheets briefly shows a contenteditable overlay for text input — so the initial `fill` appears to work. But committing the edit, navigating between cells, and interacting with Sheets' internal state doesn't work because:

1. Sheets has its own event system that ignores standard DOM events
2. Cell navigation is handled internally, not via focusable DOM elements
3. The "real" state lives in Sheets' JavaScript model, not the DOM

### Workaround for Spreadsheet Tasks

Instead of fighting the canvas, play to the tools' strengths:
- Create CSV/Excel files programmatically (via `evaluate` or file system tools)
- Save locally, then open in the browser for visual confirmation
- Use the browser for reading/verification, not data entry

This applies generally: when the DOM is just a rendering surface rather than the source of truth, prefer generating files over manipulating the UI.

## Conclusion

The browser automation tools are remarkably capable for cross-site interaction. The snapshot-based navigation with element refs is the right abstraction — it works across sites without site-specific code. The three-tier input model (standard → rich text → canvas) provides clear guidance on when browser tools will work and when to use alternative approaches.

The conversations themselves produced genuine insights about multi-model collaboration dynamics and a concrete routing architecture proposal. This validates Voice Mirror's vision of AI collaboration where the human and AI share visual context and communicate naturally.

**Codename suggestion (per GPT):** Operation Designated Tabs
