/**
 * IPC handlers for window control operations.
 * Handles: toggle-expand, minimize-window, get-window-position, set-window-position,
 *          get-cursor-position, start-drag-capture, stop-drag-capture, get-state,
 *          get-window-bounds, set-window-bounds, save-window-bounds
 */

const { ipcMain, screen } = require('electron');

/**
 * Register window control IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerWindowHandlers(ctx, validators) {
    // Local state for drag capture
    let preDragBounds = null;

    ipcMain.handle('toggle-expand', () => {
        if (ctx.getIsExpanded()) {
            ctx.collapseToOrb();
        } else {
            ctx.expandPanel();
        }
        return { success: true, data: ctx.getIsExpanded() };
    });

    ipcMain.handle('get-state', () => {
        return { success: true, data: { expanded: ctx.getIsExpanded() } };
    });

    ipcMain.handle('minimize-window', () => {
        ctx.getMainWindow()?.minimize();
        return { success: true };
    });

    ipcMain.handle('maximize-window', () => {
        const maximized = ctx.toggleMaximize();
        return { success: true, data: { maximized } };
    });

    ipcMain.handle('get-window-position', () => {
        const mainWindow = ctx.getMainWindow();
        if (mainWindow) {
            const [x, y] = mainWindow.getPosition();
            return { success: true, data: { x, y } };
        }
        return { success: true, data: { x: 0, y: 0 } };
    });

    ipcMain.handle('set-window-position', (event, x, y) => {
        const v = validators['set-window-position'](x, y);
        if (!v.valid) return { success: false, error: v.error };
        const mainWindow = ctx.getMainWindow();
        if (mainWindow) {
            mainWindow.setPosition(v.value.x, v.value.y);
            return { success: true };
        }
        return { success: false };
    });

    // Get cursor position (for drag - mouse leaves small window)
    ipcMain.handle('get-cursor-position', () => {
        const point = screen.getCursorScreenPoint();
        return { success: true, data: { x: point.x, y: point.y } };
    });

    // Drag capture: temporarily expand window to catch mouse events
    // When orb is 64x64, mouse leaves immediately - this fixes that
    ipcMain.handle('start-drag-capture', () => {
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || ctx.getIsExpanded()) return { success: false };

        // Save current bounds
        preDragBounds = mainWindow.getBounds();

        // Expand to large capture area centered on orb
        const captureSize = 800;
        const offsetX = (captureSize - preDragBounds.width) / 2;
        const offsetY = (captureSize - preDragBounds.height) / 2;

        mainWindow.setBounds({
            x: Math.round(preDragBounds.x - offsetX),
            y: Math.round(preDragBounds.y - offsetY),
            width: captureSize,
            height: captureSize
        });

        ctx.logger.info('[Window]', 'Drag capture started');
        return { success: true, originalBounds: preDragBounds };
    });

    ipcMain.handle('stop-drag-capture', (event, newX, newY) => {
        const v = validators['stop-drag-capture'](newX, newY);
        if (!v.valid) return { success: false, error: v.error };
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || ctx.getIsExpanded()) return { success: false };

        // Restore to orb size at new position
        const orbSize = ctx.getOrbSize();
        mainWindow.setBounds({
            x: v.value.newX,
            y: v.value.newY,
            width: orbSize,
            height: orbSize
        });

        // Save new position (async, don't block drag end)
        ctx.config.updateConfigAsync({ window: { orbX: v.value.newX, orbY: v.value.newY } });

        preDragBounds = null;
        ctx.logger.info('[Window]', 'Drag capture ended at', newX, newY);
        return { success: true };
    });

    // --- Frameless window resize (renderer-driven via Pointer Capture) ---

    ipcMain.handle('get-window-bounds', () => {
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { success: false };
        }
        return { success: true, data: mainWindow.getBounds() };
    });

    // Fire-and-forget: renderer sends bounds at ~60fps during drag resize.
    // Uses inline validation instead of centralized validators because this is
    // an ipcMain.on() (not handle) for performance — no async overhead at 60fps.
    ipcMain.on('set-window-bounds', (event, x, y, w, h) => {
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        // Basic validation
        if ([x, y, w, h].some(v => typeof v !== 'number' || !Number.isFinite(v))) return;
        if (w < 200 || h < 200 || w > 10000 || h > 10000) return;
        mainWindow.setBounds({
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(w),
            height: Math.round(h)
        });
    });

    // Save current panel size to config (called after resize ends)
    ipcMain.handle('save-window-bounds', () => {
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed() || !ctx.getIsExpanded()) {
            return { success: false };
        }
        const [width, height] = mainWindow.getContentSize();
        const orbSize = ctx.getOrbSize();
        if (width > orbSize && height > orbSize) {
            ctx.config.updateConfigAsync({
                appearance: { panelWidth: width, panelHeight: height }
            });
        }
        return { success: true };
    });
}

module.exports = { registerWindowHandlers };
