/**
 * attachments.svelte.js -- Shared pending attachments store.
 *
 * Holds screenshot/image attachments queued for the next message.
 * Used by both the text path (ChatInput.send) and voice path
 * (routeTranscriptionToAI) so attachments are included regardless
 * of how the message is sent.
 *
 * @typedef {{ path: string, dataUrl?: string, type: string, name: string, context?: string }} Attachment
 */

function createAttachmentsStore() {
  let attachments = $state([]);

  return {
    /** @returns {Attachment[]} Current pending attachments. */
    get pending() {
      return attachments;
    },

    /** @returns {boolean} Whether any attachments are queued. */
    get hasPending() {
      return attachments.length > 0;
    },

    /** Add an attachment to the pending list. */
    add(attachment) {
      attachments = [...attachments, attachment];
    },

    /** Remove an attachment by index. */
    remove(index) {
      attachments = attachments.filter((_, i) => i !== index);
    },

    /** Clear all pending attachments. */
    clear() {
      attachments = [];
    },

    /**
     * Take all pending attachments and clear the store.
     * Returns the attachments that were pending.
     * @returns {Attachment[]}
     */
    take() {
      const taken = attachments;
      attachments = [];
      return taken;
    },
  };
}

export const attachmentsStore = createAttachmentsStore();
