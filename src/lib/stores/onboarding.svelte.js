/**
 * onboarding.svelte.js -- Controls re-opening the welcome wizard.
 *
 * The wizard normally shows only on first run (gated on the persisted
 * `system.onboardingCompleted` config flag). This store lets the user re-open
 * it on demand (Settings → "Run welcome setup again") without clearing that
 * flag — `forceOpen` overrides the gate for one session.
 */
function createOnboardingStore() {
  let forceOpen = $state(false);

  return {
    get forceOpen() {
      return forceOpen;
    },
    /** Re-open the welcome wizard. */
    open() {
      forceOpen = true;
    },
    /** Close the forced-open wizard (called when the wizard finishes). */
    close() {
      forceOpen = false;
    },
  };
}

export const onboardingStore = createOnboardingStore();
