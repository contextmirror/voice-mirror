<script>
  /**
   * MessageCardSection -- Message card preview, avatar pickers, bubble/padding/size controls.
   */
  import { AI_AVATARS, USER_AVATARS, resolveAvatar, validateAvatarFile } from '../../../lib/avatar-presets.js';
  import { toastStore } from '../../../lib/stores/toast.svelte.js';
  import Select from '../../shared/Select.svelte';
  import Slider from '../../shared/Slider.svelte';
  import Toggle from '../../shared/Toggle.svelte';

  let {
    bubbleStyle = $bindable(),
    padding = $bindable(),
    avatarSize = $bindable(),
    showAvatars = $bindable(),
    selectedAiAvatar = $bindable(),
    selectedUserAvatar = $bindable(),
    customAvatars = $bindable(),
    fontFamily,
    fontSize,
  } = $props();

  const BUBBLE_STYLE_PRESETS = {
    rounded: { userRadius: '16px 16px 4px 16px', aiRadius: '4px 16px 16px 16px' },
    square: { userRadius: '4px', aiRadius: '4px' },
    pill: { userRadius: '20px', aiRadius: '20px' },
  };

  const bubbleStyleOptions = [
    { value: 'rounded', label: 'Rounded (Default)' },
    { value: 'square', label: 'Square' },
    { value: 'pill', label: 'Pill' },
  ];

  const resolvedAiAvatar = $derived(resolveAvatar(selectedAiAvatar, customAvatars, 'ai'));
  const resolvedUserAvatar = $derived(resolveAvatar(selectedUserAvatar, customAvatars, 'user'));

  const allAiAvatars = $derived([...AI_AVATARS, ...customAvatars.filter(a => a.role === 'ai')]);
  const allUserAvatars = $derived([...USER_AVATARS, ...customAvatars.filter(a => a.role === 'user')]);

  const previewBubbleRadii = $derived(BUBBLE_STYLE_PRESETS[bubbleStyle] || BUBBLE_STYLE_PRESETS.rounded);

  function handleUploadAvatar(role) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.jpg,.jpeg,.svg,.webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const validation = validateAvatarFile(file);
      if (!validation.valid) {
        toastStore.addToast({ message: validation.error, severity: 'error' });
        return;
      }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const id = `custom-${Date.now()}`;
        const name = file.name.replace(/\.(png|jpe?g|svg|webp)$/i, '').slice(0, 20);
        const entry = { id, name, type: 'image', dataUrl, role };
        customAvatars = [...customAvatars, entry];
        if (role === 'ai') selectedAiAvatar = id;
        else selectedUserAvatar = id;
        toastStore.addToast({ message: `Added custom ${role} avatar "${name}"`, severity: 'success' });
      } catch (err) {
        console.error('[MessageCardSection] Avatar upload failed:', err);
        toastStore.addToast({ message: 'Failed to read image file', severity: 'error' });
      }
    };
    input.click();
  }

  function deleteCustomAvatar(id) {
    const avatar = customAvatars.find(a => a.id === id);
    if (!avatar) return;
    customAvatars = customAvatars.filter(a => a.id !== id);
    if (avatar.role === 'ai' && selectedAiAvatar === id) selectedAiAvatar = 'cube';
    if (avatar.role === 'user' && selectedUserAvatar === id) selectedUserAvatar = 'person';
    toastStore.addToast({ message: `Removed custom avatar "${avatar.name}"`, severity: 'success' });
  }
</script>

<section class="settings-section">
  <h3>Message Cards</h3>
  <div class="settings-group">
    <!-- Preview -->
    <div class="msg-preview-area">
      <div class="msg-preview-container" style:font-family={fontFamily}>
        <div class="msg-bubble-row msg-user-row">
          <div
            class="msg-bubble msg-user"
            style:border-radius={previewBubbleRadii.userRadius}
            style:font-size="{fontSize}px"
            style:padding="{padding}px {padding + 4}px"
          >
            What's the weather like today?
          </div>
          {#if showAvatars}
            <div class="msg-avatar msg-avatar-user" style:width="{avatarSize}px" style:height="{avatarSize}px">
              {#if resolvedUserAvatar.type === 'image'}
                <img src={resolvedUserAvatar.dataUrl} alt={resolvedUserAvatar.name} class="msg-avatar-img" />
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="60%" height="60%">
                  {@html resolvedUserAvatar.svg}
                </svg>
              {/if}
            </div>
          {/if}
        </div>
        <div class="msg-bubble-row msg-ai-row">
          {#if showAvatars}
            <div class="msg-avatar msg-avatar-ai" style:width="{avatarSize}px" style:height="{avatarSize}px">
              {#if resolvedAiAvatar.type === 'image'}
                <img src={resolvedAiAvatar.dataUrl} alt={resolvedAiAvatar.name} class="msg-avatar-img" />
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="60%" height="60%">
                  {@html resolvedAiAvatar.svg}
                </svg>
              {/if}
            </div>
          {/if}
          <div
            class="msg-bubble msg-ai"
            style:border-radius={previewBubbleRadii.aiRadius}
            style:font-size="{fontSize}px"
            style:padding="{padding}px {padding + 4}px"
          >
            It's a <b>beautiful day</b> outside! Currently 72°F with clear skies.
          </div>
        </div>
      </div>
    </div>

    <!-- AI Avatar picker -->
    <div class="avatar-picker-section">
      <span class="avatar-picker-label">AI Avatar</span>
      <div class="avatar-picker-grid">
        {#each allAiAvatars as av (av.id)}
          <div
            class="avatar-picker-item"
            class:active={selectedAiAvatar === av.id}
            role="button" tabindex="0" title={av.name}
            onclick={() => { selectedAiAvatar = av.id; }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectedAiAvatar = av.id; }}
          >
            {#if av.type === 'image'}
              <img src={av.dataUrl} alt={av.name} class="avatar-picker-img" />
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                {@html av.svg}
              </svg>
            {/if}
            {#if av.type === 'image'}
              <button class="avatar-delete-btn" title="Remove"
                onclick={(e) => { e.stopPropagation(); deleteCustomAvatar(av.id); }}>&times;</button>
            {/if}
          </div>
        {/each}
        <button class="avatar-upload-btn" title="Upload custom AI avatar"
          onclick={() => handleUploadAvatar('ai')}>+</button>
      </div>
    </div>

    <!-- User Avatar picker -->
    <div class="avatar-picker-section">
      <span class="avatar-picker-label">Your Avatar</span>
      <div class="avatar-picker-grid">
        {#each allUserAvatars as av (av.id)}
          <div
            class="avatar-picker-item"
            class:active={selectedUserAvatar === av.id}
            role="button" tabindex="0" title={av.name}
            onclick={() => { selectedUserAvatar = av.id; }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectedUserAvatar = av.id; }}
          >
            {#if av.type === 'image'}
              <img src={av.dataUrl} alt={av.name} class="avatar-picker-img" />
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                {@html av.svg}
              </svg>
            {/if}
            {#if av.type === 'image'}
              <button class="avatar-delete-btn" title="Remove"
                onclick={(e) => { e.stopPropagation(); deleteCustomAvatar(av.id); }}>&times;</button>
            {/if}
          </div>
        {/each}
        <button class="avatar-upload-btn" title="Upload custom user avatar"
          onclick={() => handleUploadAvatar('user')}>+</button>
      </div>
    </div>

    <Select label="Bubble Style" value={bubbleStyle} options={bubbleStyleOptions}
      onChange={(v) => (bubbleStyle = v)} />
    <Slider label="Padding" value={padding} min={4} max={24} step={2}
      onChange={(v) => (padding = v)} formatValue={(v) => v + 'px'} />
    <Slider label="Avatar Size" value={avatarSize} min={20} max={64} step={2}
      onChange={(v) => (avatarSize = v)} formatValue={(v) => v + 'px'} />
    <Toggle label="Show Avatars" checked={showAvatars} onChange={(v) => (showAvatars = v)} />
  </div>
</section>

<style>
  .msg-preview-area {
    padding: 16px; margin: 8px;
    background: var(--bg); border-radius: var(--radius-md); border: 1px solid var(--border);
    overflow: hidden;
  }
  .msg-preview-container {
    display: flex; flex-direction: column; gap: 12px;
    max-width: 400px; margin: 0 auto;
  }
  .msg-bubble { border: 1px solid; color: var(--text); line-height: 1.5; word-wrap: break-word; }
  .msg-bubble.msg-user { max-width: 85%; background: var(--msg-user-bg); border-color: var(--msg-user-border); }
  .msg-bubble.msg-ai { background: var(--msg-ai-bg); border-color: var(--msg-ai-border); flex: 1; max-width: 85%; }

  .msg-bubble-row { display: flex; gap: 8px; align-items: flex-start; }
  .msg-bubble-row.msg-ai-row { align-self: flex-start; }
  .msg-bubble-row.msg-user-row { align-self: flex-end; }

  .msg-avatar {
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; flex-shrink: 0; overflow: hidden;
  }
  .msg-avatar-ai {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
    color: var(--accent-contrast);
  }
  .msg-avatar-user {
    background: var(--accent-subtle); border: 1px solid var(--accent); color: var(--accent);
  }
  .msg-avatar-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }

  .avatar-picker-section { padding: 12px; }
  .avatar-picker-label {
    display: block; color: var(--muted); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px;
  }
  .avatar-picker-grid { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

  .avatar-picker-item {
    position: relative; width: 32px; height: 32px; border-radius: 50%;
    border: 2px solid var(--border); background: var(--bg);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all var(--duration-fast) var(--ease-out);
    color: var(--muted); overflow: hidden;
  }
  .avatar-picker-item:hover { border-color: var(--border-strong); background: var(--bg-hover); color: var(--text); }
  .avatar-picker-item.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-glow); color: var(--accent); }

  .avatar-picker-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }

  .avatar-delete-btn {
    position: absolute; top: -3px; right: -3px;
    width: 14px; height: 14px; border-radius: 50%; border: none;
    background: var(--danger); color: white; font-size: 10px; line-height: 1;
    cursor: pointer; display: none; align-items: center; justify-content: center; padding: 0;
  }
  .avatar-picker-item:hover .avatar-delete-btn { display: flex; }

  .avatar-upload-btn {
    width: 32px; height: 32px; border-radius: 50%;
    border: 2px dashed var(--border); background: none;
    color: var(--muted); font-size: 16px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all var(--duration-fast) var(--ease-out);
  }
  .avatar-upload-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-subtle); }
</style>
