# Vision Model Benchmarks for Voice Mirror

Evaluating local vision models for desktop screenshot understanding — the core use case for Voice Mirror's screen-aware voice assistant.

## Test Setup

- **Hardware**: Windows, 2560x1440 display
- **Test image**: Live desktop screenshot (Chrome with Watch Footy stream + VS Code with code)
- **Ollama**: Local inference via `POST /api/chat` with `think: false`
- **Token limit**: 16,384
- **Benchmark script**: `node test/benchmark/vision-benchmark.mjs`

## Prompt Categories

| ID | Prompt | Voice Mirror Use Case |
|---|---|---|
| `describe` | What applications and windows are visible? Describe the layout. | User asks "what's on my screen?" |
| `read-text` | Read all visible text on this screen. | OCR / reading content for context |
| `identify-ui` | List all clickable buttons, menus, input fields with positions. | Finding elements to interact with |
| `tool-call` | User says "click the search bar". Identify the target element. | Targeted voice commands |

## Results

### qwen3-vl:8b (Q4_K_M, 6.1 GB)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 7.8–9.7s | 698–863 | Excellent — identified apps, tabs, content, layout accurately |
| Read Text | 91.9s | 7,014 | Detailed but very slow. Read URLs, stream names, code, Discord usernames |
| Identify UI | 54.2s | 3,793 | Found 10+ elements with positions. Non-deterministic (failed 2/3 runs at 2k tokens) |
| Tool Calling | 7.0s | 345 | Fast and accurate. Correctly identified search bar with position and action |

**Strengths:**
- Describe and Tool Calling prompts are fast (7-10s) and accurate
- Caught fine details: "Live 53'", "Checking Goal - Possible Offside", tab names, terminal status text
- Good spatial awareness (left/right split, top-left/center-right positions)

**Weaknesses:**
- Exhaustive prompts (Read Text, Identify UI) are far too slow (50-90s) for a voice assistant
- Thinking mode eats tokens — at 2k limit, Identify UI and Read Text returned empty responses
- Non-deterministic on complex prompts (Identify UI worked 1/3 runs at low token limits)

**Verdict:** Good for targeted, fast queries ("what app is focused?", "where is X?"). Too slow for exhaustive tasks. Needs generous token limits (8k+) and `think: false` to be usable.

---

### gemma-3-4b-it (Q4_K_M, 2.5 GB + 851 MB projector)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 17.9s | 292 | Partial — called Watch Footy "YouTube", missed VS Code/terminal entirely |
| Read Text | 5.5s | 704 | Fast but hallucinated — repeated same text block 6x, fabricated URLs |
| Identify UI | 3.8s | 482 | Fast but hallucinated — invented "bbc.com", "TV Guide", "Rugby/Tennis" nav |
| Tool Calling | 0.8s | 87 | Very fast, generic but reasonable ("search bar at top center") |

**Strengths:**
- Extremely fast on all prompts — Read Text and Identify UI under 6s (vs 50-90s on Qwen3-VL)
- Tool Calling at 0.8s is the fastest we've seen
- Small model size (2.5 GB weights + 851 MB projector = 3.4 GB total)

**Weaknesses:**
- Heavy hallucination on exhaustive prompts — fabricates UI elements, URLs, and page content
- Read Text output loops/repeats rather than reading actual screen text
- Describe missed half the screen (right side VS Code + terminal invisible)
- Low spatial awareness — misidentified which app was on screen

**Verdict:** Too inaccurate for Voice Mirror. Speed is excellent but hallucination makes it unreliable for screen understanding. Would give users wrong information about what's on their screen.

---

### gemma-3-12b-it (Q4_K_M, 7.3 GB + 854 MB projector)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 8.3s | 343 | Good — identified YouTube stream, Edge, Discord, File Explorer, multiple windows |
| Read Text | 9.9s | 729 | Structured output, correct layout. Hallucinates specific text (subscriber counts, usernames) |
| Identify UI | 12.6s | 871 | Well-organized by category. Found real elements (video controls, search, menus). Some wrong names |
| Tool Calling | 2.9s | 205 | Good — handled both "search bar" and "main menu" scenarios with position + action |

**Strengths:**
- All prompts under 13s — a major improvement over Qwen3-VL's 54-92s on exhaustive tasks
- Describe is accurate and fast (8.3s), comparable to Qwen3-VL quality
- Identify UI is well-structured and organized by category (menus, buttons, inputs)
- Tool Calling handles multiple scenarios intelligently
- No repetitive looping or empty responses

**Weaknesses:**
- Hallucinates specific text details — subscriber counts, chat messages, URLs that aren't actually on screen
- Gets app/site names slightly wrong ("Watch Soccer" instead of "Watch Footy", "Crystal Palace" instead of actual opponent)
- Read Text fabricates plausible-looking data rather than reading actual OCR text
- Larger model size (8.2 GB total) means slower first-load

**Verdict:** Best balance of speed and accuracy so far. All prompts within Voice Mirror's 15s target. Hallucination on fine details is the main weakness — could be addressed with LoRA fine-tuning for structured output. Strong candidate for Voice Mirror's vision backbone.

---

### moondream (1.7 GB)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 0.2s | 57 | Vague — "two open tabs, one with soccer game, error message on right side". No app names |
| Read Text | 0.0s | 1 | **Complete failure** — returned empty response |
| Identify UI | 0.1s | 6 | Useless — "1. Purple screen" |
| Tool Calling | 0.0s | 1 | **Complete failure** — returned empty response |

**Strengths:**
- Fastest model tested — all prompts under 0.2s
- Tiny model size (1.7 GB) — minimal VRAM footprint

**Weaknesses:**
- Read Text and Tool Calling completely failed — returned nothing
- Identify UI found only 1 "element" ("Purple screen")
- Describe is too vague to be useful — no app names, no layout details
- Vision capability appears extremely limited for complex desktop screenshots

**Verdict:** Not viable for Voice Mirror. The model is too small to understand complex desktop screenshots. Speed is irrelevant when accuracy is near-zero.

---

### minicpm-v (5.5 GB)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 3.2s | 391 | Excellent — Watch Footy, VS Code, Discord, live scores, stream links, code editor content |
| Read Text | 2.0s | 250 | Good — read URLs, match score, stream links, source list. Only covers left screen |
| Identify UI | 3.9s | 471 | Good — video controls, tabs, code editor, terminal, Discord invite, status bar |
| Tool Calling | 1.3s | 155 | Good — search bar top area, hamburger menu icon, clear action instructions |

**Strengths:**
- All prompts under 4s — fastest accurate model tested
- Describe at 3.2s is the best accuracy-to-speed ratio across all models
- Identified more apps correctly than any other model (Watch Footy, VS Code, Discord, terminal)
- Read Text actually works at 2.0s — structured output with real screen content
- Identify UI organizes by screen section with reasonable element descriptions

**Weaknesses:**
- Read Text only covers left screen content (Watch Footy side), misses right side (VS Code/terminal)
- Some hallucinated details — "Error Message Box" on right side, fabricated `http_status` error
- Called Claude Code terminal "ChatGPT" (minor misidentification)
- Describe hallucinates some specifics (Python instead of JavaScript, wrong score details)

**Verdict:** Best overall performer for Voice Mirror. All 4 prompts under 4s with good accuracy. Describe and Tool Call are both fast and useful. Read Text works (unlike the looping seen under GPU contention). Main weakness is hallucinating specific details, but layout/app identification is strong. Top pick for real-time voice assistant use.

---

### ministral-3:14b (Q4_K_M, 9.1 GB)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 11.2s | 548 | Excellent — Watch Footy, VS Code, Discord, script filenames, project names, three-section layout |
| Read Text | 19.4s | 1,366 | **Best OCR by far** — read terminal commands, Discord usernames, viewer counts, URLs, tab names |
| Identify UI | 9.1s | 705 | Thorough — hamburger menu, search bar, stream tabs, video controls, Discord widget, browser tabs |
| Tool Calling | 5.2s | 398 | Detailed — specific element descriptions, locations, and actions for both scenarios |

**Strengths:**
- Best text reading accuracy of any model tested — read actual terminal commands, specific numbers, usernames
- Describe correctly identified all three apps plus project-specific details (script names, channel names)
- Native tool calling support built into the model (Ollama confirms `tools` capability)
- Structured, well-organized output with markdown formatting
- 262K context length — no token limit issues
- Apache 2.0 license, strong LoRA ecosystem (unsloth)

**Weaknesses:**
- Slower than MiniCPM-V on all prompts (5-19s vs 1-4s)
- Read Text at 19.4s exceeds the 15s target for complex queries
- Verbose output — 398 tokens for Tool Calling vs MiniCPM-V's 155
- 9.1 GB is the second largest model tested

**Verdict:** Best quality model tested, especially for text reading and agentic use. Native tool calling makes it the strongest candidate for LoRA fine-tuning into a screen-aware agent. Speed is the trade-off — 2-3x slower than MiniCPM-V but dramatically more accurate. Could potentially speed up with structured JSON output via LoRA (fewer tokens = faster).

---

### llama3.2-vision:11b (Q4_K_M, 7.8 GB)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 6.4s | 88 | Vague — "web browser with football game, chat window, terminal window". No app names |
| Read Text | 201.3s | 16,384 | **Infinite loop** — "Watch Footy" repeated 16,000+ times until token limit |
| Identify UI | 8.5s | 388 | Not evaluated (Read Text/Tool Call failures overshadow) |
| Tool Calling | 217.1s | 16,384 | **Infinite loop** — maxed tokens, 217 seconds |

**Strengths:**
- Describe is reasonably fast at 6.4s
- 128K context, well-known model with strong LoRA ecosystem (unsloth)

**Weaknesses:**
- Read Text and Tool Calling both enter infinite repetition loops, maxing 16k tokens
- Describe is vague — no specific app names, generic descriptions
- No native tool calling in Ollama (confirmed: `tools` capability missing)
- Two prompts completely unusable

**Verdict:** Not viable. Infinite loops on Read Text and Tool Calling make it unreliable. Even the working prompts are vague. Despite strong LoRA support, the base model's vision quality is too weak for Voice Mirror.

---

### ibm/granite3.3-vision:2b (Q8_0, 4.5 GB)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 2.5s | 55 | Vague — "soccer match, email client, chat window". Generic, no real app names |
| Read Text | 7.8s | 1,133 | Impressive OCR — read terminal commands, URLs, Discord names, stream sources, code |
| Identify UI | 4.0s | 552 | Moderate — found nav bar, search bar, Discord button. Some hallucinated elements |
| Tool Calling | 0.8s | 100 | Fast but generic — "search bar at top of webpage" |

**Strengths:**
- Very fast — all prompts under 8s, Tool Calling at 0.8s
- Read Text is surprisingly good for a 2B model — read real terminal text, URLs, code snippets
- Tiny model (4.5 GB) with native tool calling support
- 131K context length, Apache 2.0

**Weaknesses:**
- Describe is too vague — calls VS Code "email client", misidentifies apps
- Read Text has OCR artifacts — garbled characters, partial words
- Tool Calling is generic, doesn't leverage what it sees on screen
- Small model can't reason well about complex screen layouts

**Verdict:** Interesting as a fast OCR specialist — Read Text quality punches above its weight. Too inaccurate on Describe and layout understanding for Voice Mirror's main use case. Could work as a secondary fast-OCR model in a pipeline.

---

### mistral-small3.2 (Q4_K_M, 15 GB — 24B params)

| Prompt | Time | Tokens | Result |
|---|---|---|---|
| Describe | 50.4s | 268 | Excellent quality — Watch Footy, VS Code, Discord, terminal, file names |
| Read Text | 112.4s | 873 | Excellent OCR — stream sources with counts, terminal commands, Discord usernames |
| Identify UI | 92.4s | 480 | Good — stream links, Discord join, browser tabs with names, video controls |
| Tool Calling | 38.3s | 147 | Good — identified search bar below nav tabs with clear action |

**Strengths:**
- Quality matches or exceeds Ministral-3 14B on all prompts
- Read Text accuracy is excellent — real viewer counts, terminal commands, Discord names
- Native tool calling support
- Strong LoRA ecosystem (unsloth)

**Weaknesses:**
- **Far too slow** — 38-112 seconds per prompt due to VRAM overflow (15 GB model on 16 GB GPU)
- CPU offloading destroys inference speed (~5 tok/s vs 50+ tok/s for models that fit)
- Quality improvement over Ministral-3 14B is marginal, speed penalty is 5-10x
- Not practical on this hardware

**Verdict:** Confirms that the Mistral 3 family produces the best vision+agentic output. But at 24B params it doesn't fit in 16GB VRAM without crippling speed. Ministral-3 14B is the sweet spot for this GPU.

---

## Summary Comparison

| Model | Size | Describe | Read Text | Identify UI | Tool Call | Overall |
|---|---|---|---|---|---|---|
| qwen3-vl:8b | 6.1 GB | 7-10s | 92s | 54s (flaky) | 7s | Good for targeted prompts only |
| gemma-3-4b-it | 3.4 GB | 17.9s | 5.5s | 3.8s | 0.8s | Fast but too many hallucinations |
| gemma-3-12b-it | 8.2 GB | 8.3s | 9.9s | 12.6s | 2.9s | Best balance — all prompts <15s |
| moondream | 1.7 GB | 0.2s | FAIL | FAIL | FAIL | Too small — near-zero accuracy |
| minicpm-v | 5.5 GB | 3.2s | 2.0s | 3.9s | 1.3s | Fastest accurate — all prompts <4s |
| ministral-3:14b | 9.1 GB | 11.2s | 19.4s | 9.1s | 5.2s | **Best quality + native tool calling** |
| llama3.2-vision | 7.8 GB | 6.4s | 201s (loop) | 8.5s | 217s (loop) | Broken — infinite loops |
| granite3.3-vision | 4.5 GB | 2.5s | 7.8s | 4.0s | 0.8s | Fast OCR specialist, vague describe |
| mistral-small3.2 | 15 GB | 50.4s | 112.4s | 92.4s | 38.3s | Great quality, too slow (VRAM overflow) |
| | | | | | | |

## Notes

- All times are wall-clock on local hardware — will vary by GPU
- "Flaky" means the prompt sometimes returns empty when thinking consumes all tokens
- For Voice Mirror, target is <5s for common queries, <15s acceptable for complex ones
- LoRA fine-tuning on structured JSON output could significantly reduce token count and latency
