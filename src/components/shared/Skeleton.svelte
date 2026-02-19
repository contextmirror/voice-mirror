<script>
  /**
   * Skeleton.svelte -- Shimmer/pulse skeleton placeholder component.
   *
   * Used as a loading state placeholder while content is being fetched.
   *
   * Props:
   *   width {string} - CSS width (default: '100%')
   *   height {string} - CSS height (default: '16px')
   *   rounded {boolean} - Use fully rounded corners (default: false)
   *   circle {boolean} - Render as a circle (default: false)
   */
  let {
    width = '100%',
    height = '16px',
    rounded = false,
    circle = false,
  } = $props();

  const borderRadius = $derived(
    circle ? '50%' : rounded ? 'var(--radius-full)' : 'var(--radius-sm)'
  );
</script>

<div
  class="skeleton"
  style:width={circle ? height : width}
  style:height
  style:border-radius={borderRadius}
  aria-hidden="true"
></div>

<style>
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--bg-hover) 25%,
      var(--bg-elevated) 50%,
      var(--bg-hover) 75%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
      background: var(--bg-hover);
    }
  }
</style>
