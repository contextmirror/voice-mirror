/**
 * voice-greeting.js -- Plays "Voice Mirror is Online" on first voice-event Ready.
 *
 * Listens for the voice pipeline's `ready` event and speaks a startup greeting
 * if `voice.announceStartup` is enabled in config (default: true).
 *
 * Imported and called from App.svelte on mount.
 */
import { listen } from '@tauri-apps/api/event';
import { speakText } from './api.js';
import { configStore } from './stores/config.svelte.js';

let greetingPlayed = false;

/**
 * Listen for voice pipeline ready event and play startup greeting.
 * Call once on app mount.
 */
export async function initStartupGreeting() {
  await listen('voice-event', (event) => {
    const payload = event.payload;
    if (!payload || greetingPlayed) return;

    if (payload.event === 'ready') {
      greetingPlayed = true;

      // Check config for announcement preference
      // Config uses camelCase (voice.announceStartup) per schema.rs serde(rename_all = "camelCase")
      const cfg = configStore.value;
      const announceStartup = cfg?.voice?.announceStartup !== false;

      if (announceStartup) {
        // Small delay to let pipeline fully settle
        setTimeout(() => {
          speakText('Voice Mirror is Online').catch((err) => {
            console.warn('[greeting] Failed to speak startup greeting:', err);
          });
        }, 500);
      }
    }
  });
}
