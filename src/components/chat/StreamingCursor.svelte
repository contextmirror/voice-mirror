<!-- StreamingCursor -- Blinking block cursor, pure CSS animation. -->
<span class="streaming-cursor" aria-hidden="true">&#x2588;</span>

<style>
  .streaming-cursor {
    display: inline;
    color: var(--accent);
    font-weight: bold;
    animation: blink-cursor 0.8s step-end infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .streaming-cursor {
      animation: none;
      opacity: 0.7;
    }
  }

  @keyframes blink-cursor {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
</style>
