// Voice Mirror — Design Overlay (Flameshot-style drawing toolkit)
// Self-contained IIFE providing canvas drawing tools for screenshot annotation.
(function () {
    'use strict';

    if (window.vmDesign) return;

    // --- State ---
    var canvas = null;
    var ctx = null;
    var currentTool = 'pen';
    var currentColor = '#ff0000';
    var currentSize = 3;
    var strokes = [];
    var redoStack = [];
    var drawing = false;
    var currentStroke = null;
    var shiftHeld = false;
    var textInput = null;

    // --- Select mode state ---
    var _selectMode = false;
    var _hoveredEl = null;
    var _selectedElement = null;
    var _selectTooltip = null;
    var _selectActionBar = null;

    // --- Listeners (stored for cleanup) ---
    var _onMouseDown = null;
    var _onMouseMove = null;
    var _onMouseUp = null;
    var _onKeyDown = null;
    var _onKeyUp = null;
    var _onResize = null;

    // =========================================================================
    // Stroke rendering
    // =========================================================================

    function _drawStroke(stroke) {
        if (!ctx) return;
        ctx.save();

        switch (stroke.tool) {
            case 'pen':
                _drawPen(stroke);
                break;
            case 'line':
                _drawLine(stroke);
                break;
            case 'arrow':
                _drawArrow(stroke);
                break;
            case 'rect':
                _drawRect(stroke);
                break;
            case 'circle':
                _drawCircle(stroke);
                break;
            case 'text':
                _drawText(stroke);
                break;
            case 'marker':
                _drawMarker(stroke);
                break;
            case 'pixelate':
                _drawPixelate(stroke);
                break;
        }

        ctx.restore();
    }

    function _drawPen(stroke) {
        if (stroke.points.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = 1;
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (var i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
    }

    function _drawLine(stroke) {
        if (stroke.points.length < 2) return;
        var p0 = stroke.points[0];
        var p1 = stroke.points[1];
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
    }

    function _drawArrow(stroke) {
        if (stroke.points.length < 2) return;
        var p0 = stroke.points[0];
        var p1 = stroke.points[1];
        var dx = p1.x - p0.x;
        var dy = p1.y - p0.y;
        var angle = Math.atan2(dy, dx);
        var len = Math.sqrt(dx * dx + dy * dy);

        // Arrowhead geometry (inspired by Flameshot's getArrowHead)
        var headLen = Math.min(12 + stroke.size * 2, len * 0.4);

        // Shorten the shaft so it doesn't poke through the arrowhead
        var shaftEndX = p1.x - headLen * Math.cos(angle);
        var shaftEndY = p1.y - headLen * Math.sin(angle);

        // Draw shaft
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(shaftEndX, shaftEndY);
        ctx.stroke();

        // Draw filled arrowhead triangle (30-degree spread on each side)
        var ax = p1.x - headLen * Math.cos(angle - Math.PI / 6);
        var ay = p1.y - headLen * Math.sin(angle - Math.PI / 6);
        var bx = p1.x - headLen * Math.cos(angle + Math.PI / 6);
        var by = p1.y - headLen * Math.sin(angle + Math.PI / 6);

        ctx.beginPath();
        ctx.fillStyle = stroke.color;
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.closePath();
        ctx.fill();
    }

    function _drawRect(stroke) {
        if (stroke.points.length < 2) return;
        var p0 = stroke.points[0];
        var p1 = stroke.points[1];
        var x = Math.min(p0.x, p1.x);
        var y = Math.min(p0.y, p1.y);
        var w = Math.abs(p1.x - p0.x);
        var h = Math.abs(p1.y - p0.y);

        // Shift = square constraint
        if (stroke.shift) {
            var side = Math.max(w, h);
            if (p1.x < p0.x) x = p0.x - side;
            if (p1.y < p0.y) y = p0.y - side;
            w = side;
            h = side;
        }

        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineJoin = 'miter';
        ctx.rect(x, y, w, h);
        ctx.stroke();
    }

    function _drawCircle(stroke) {
        if (stroke.points.length < 2) return;
        var p0 = stroke.points[0];
        var p1 = stroke.points[1];
        var cx = (p0.x + p1.x) / 2;
        var cy = (p0.y + p1.y) / 2;
        var rx = Math.abs(p1.x - p0.x) / 2;
        var ry = Math.abs(p1.y - p0.y) / 2;

        // Shift = perfect circle
        if (stroke.shift) {
            var r = Math.max(rx, ry);
            rx = r;
            ry = r;
            cx = p0.x + (p1.x > p0.x ? r : -r);
            cy = p0.y + (p1.y > p0.y ? r : -r);
        }

        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    function _drawText(stroke) {
        if (!stroke.text) return;
        var p = stroke.points[0];
        ctx.fillStyle = stroke.color;
        ctx.font = stroke.fontSize + 'px sans-serif';
        ctx.textBaseline = 'top';

        // Multiline support (matches the textarea's line-height: 1.25)
        var lineH = stroke.fontSize * 1.25;
        var lines = stroke.text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], p.x, p.y + i * lineH);
        }
    }

    function _drawMarker(stroke) {
        if (stroke.points.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = Math.max(stroke.size, 15);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.3;
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (var i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
    }

    function _drawPixelate(stroke) {
        if (stroke.points.length < 2) return;
        var p0 = stroke.points[0];
        var p1 = stroke.points[1];
        var x = Math.min(p0.x, p1.x);
        var y = Math.min(p0.y, p1.y);
        var w = Math.abs(p1.x - p0.x);
        var h = Math.abs(p1.y - p0.y);

        if (stroke.imageData) {
            // Finalized: draw the mosaic
            ctx.putImageData(stroke.imageData, x, y);
        } else {
            // Preview during drag: show dashed selection rectangle
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
        }
    }

    // =========================================================================
    // Full redraw
    // =========================================================================

    function _redrawAll() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (var i = 0; i < strokes.length; i++) {
            _drawStroke(strokes[i]);
        }
    }

    // =========================================================================
    // Pixelate helper — capture region and render mosaic blocks
    // =========================================================================

    function _computePixelate(x, y, w, h) {
        if (w < 1 || h < 1) return null;
        var blockSize = 8;

        // Redraw committed strokes to get a clean canvas state for capture
        _redrawAll();

        var srcData = ctx.getImageData(x, y, w, h);
        var data = srcData.data;
        var out = ctx.createImageData(w, h);
        var outData = out.data;
        var hasContent = false;

        // Process each blockSize x blockSize block
        for (var by = 0; by < h; by += blockSize) {
            for (var bx = 0; bx < w; bx += blockSize) {
                var bw = Math.min(blockSize, w - bx);
                var bh = Math.min(blockSize, h - by);

                // Average color of this block
                var rSum = 0, gSum = 0, bSum = 0, aSum = 0;
                var count = bw * bh;
                for (var py = 0; py < bh; py++) {
                    for (var px = 0; px < bw; px++) {
                        var idx = ((by + py) * w + (bx + px)) * 4;
                        rSum += data[idx];
                        gSum += data[idx + 1];
                        bSum += data[idx + 2];
                        aSum += data[idx + 3];
                    }
                }

                var rAvg = Math.round(rSum / count);
                var gAvg = Math.round(gSum / count);
                var bAvg = Math.round(bSum / count);
                var aAvg = Math.round(aSum / count);

                // Skip fully transparent blocks (canvas overlay has no page content)
                if (aAvg < 30) continue;

                hasContent = true;

                // Fill entire block with the averaged color
                for (var py2 = 0; py2 < bh; py2++) {
                    for (var px2 = 0; px2 < bw; px2++) {
                        var outIdx = ((by + py2) * w + (bx + px2)) * 4;
                        outData[outIdx] = rAvg;
                        outData[outIdx + 1] = gAvg;
                        outData[outIdx + 2] = bAvg;
                        outData[outIdx + 3] = aAvg;
                    }
                }
            }
        }

        // Nothing to pixelate — all transparent (no annotations in this region)
        if (!hasContent) return null;
        return out;
    }

    // =========================================================================
    // Text input overlay (Flameshot-style: click to place, auto-resize,
    // draggable, font size = currentSize * 4 + 8)
    // =========================================================================

    var _textDrag = null; // { startMouseX, startMouseY, startLeft, startTop }

    function _getTextFontSize() {
        // Maps slider 1-20 → 12px-88px (same formula as toolbar label)
        return currentSize * 4 + 8;
    }

    function _createTextInput(x, y) {
        _removeTextInput();

        var fontSize = _getTextFontSize();

        // Outer container — handles drag & border
        var wrapper = document.createElement('div');
        wrapper.setAttribute('data-vm-text', '1');
        wrapper.style.cssText = [
            'position:fixed',
            'left:' + x + 'px',
            'top:' + y + 'px',
            'min-width:60px',
            'border:1.5px dashed ' + currentColor,
            'border-radius:3px',
            'z-index:1000000',
            'cursor:move',
            'box-sizing:border-box',
            'padding:0'
        ].join(';');

        // Textarea (actual editing surface)
        var ta = document.createElement('textarea');
        ta.style.cssText = [
            'display:block',
            'width:100%',
            'min-width:60px',
            'min-height:' + (fontSize + 8) + 'px',
            'background:transparent',
            'border:none',
            'outline:none',
            'color:' + currentColor,
            'font-size:' + fontSize + 'px',
            'font-family:sans-serif',
            'line-height:1.25',
            'padding:4px 6px',
            'resize:both',
            'overflow:hidden',
            'white-space:pre-wrap',
            'word-wrap:break-word',
            'box-sizing:border-box',
            'cursor:text'
        ].join(';');

        ta.rows = 1;
        ta.placeholder = 'Type here...';

        var commitColor = currentColor;
        var commitFontSize = fontSize;
        var committed = false;

        function getPosition() {
            return {
                x: parseFloat(wrapper.style.left) || x,
                y: parseFloat(wrapper.style.top) || y
            };
        }

        function commit() {
            if (committed) return;
            committed = true;
            var val = ta.value;
            var pos = getPosition();
            _removeTextInput();
            if (val.length === 0) return;
            strokes.push({
                tool: 'text',
                color: commitColor,
                size: commitFontSize,
                points: [{ x: pos.x + 6, y: pos.y + 4 }],
                text: val,
                fontSize: commitFontSize
            });
            redoStack = [];
            _redrawAll();
        }

        // --- Keyboard ---
        ta.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ta.blur();
            }
            if (e.key === 'Escape') {
                ta.value = '';
                ta.blur();
            }
        });
        ta.addEventListener('input', function () {
            // Auto-grow height
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        });
        ta.addEventListener('blur', function () {
            // Small delay so clicking the wrapper border doesn't commit
            setTimeout(function () {
                if (textInput && document.activeElement !== ta) {
                    commit();
                }
            }, 150);
        });

        // --- Drag (on the wrapper border / non-textarea area) ---
        wrapper.addEventListener('mousedown', function (e) {
            // Only drag from the wrapper border, not the textarea
            if (e.target === ta) return;
            e.preventDefault();
            e.stopPropagation();
            _textDrag = {
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                startLeft: parseFloat(wrapper.style.left) || x,
                startTop: parseFloat(wrapper.style.top) || y
            };

            function onMove(ev) {
                if (!_textDrag) return;
                var dx = ev.clientX - _textDrag.startMouseX;
                var dy = ev.clientY - _textDrag.startMouseY;
                wrapper.style.left = (_textDrag.startLeft + dx) + 'px';
                wrapper.style.top = (_textDrag.startTop + dy) + 'px';
            }
            function onUp() {
                _textDrag = null;
                window.removeEventListener('mousemove', onMove, true);
                window.removeEventListener('mouseup', onUp, true);
            }
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
        });

        // Stop canvas from receiving clicks on the text widget
        wrapper.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        wrapper.addEventListener('mousemove', function (e) { e.stopPropagation(); });
        wrapper.addEventListener('mouseup', function (e) { e.stopPropagation(); });

        wrapper.appendChild(ta);
        document.body.appendChild(wrapper);
        textInput = wrapper;
        textInput._textarea = ta;

        // Defer focus so mouseup doesn't steal it
        setTimeout(function () { ta.focus(); }, 10);
    }

    function _removeTextInput() {
        if (textInput && textInput.parentNode) {
            textInput.parentNode.removeChild(textInput);
        }
        textInput = null;
        _textDrag = null;
    }

    // =========================================================================
    // Element select mode (DevTools-style element picker)
    // =========================================================================

    /**
     * Build a minimal unique CSS selector path from element up to nearest
     * ancestor with an id, or body. Uses tag.class and :nth-child for
     * disambiguation when siblings share the same tag.
     */
    function _buildSelector(el) {
        var parts = [];
        var cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
            var seg = cur.tagName.toLowerCase();
            if (cur.id) {
                seg = seg + '#' + cur.id;
                parts.unshift(seg);
                break;
            }
            if (cur.className && typeof cur.className === 'string') {
                var classes = cur.className.trim().split(/\s+/);
                for (var i = 0; i < classes.length; i++) {
                    if (classes[i]) seg += '.' + classes[i];
                }
            }
            // Disambiguate among siblings with the same tag
            var parent = cur.parentElement;
            if (parent) {
                var siblings = parent.children;
                var sameTag = 0;
                for (var j = 0; j < siblings.length; j++) {
                    if (siblings[j].tagName === cur.tagName) sameTag++;
                }
                if (sameTag > 1) {
                    seg += ':nth-child(' + (Array.prototype.indexOf.call(parent.children, cur) + 1) + ')';
                }
            }
            parts.unshift(seg);
            cur = cur.parentElement;
        }
        if (parts.length === 0) return el.tagName.toLowerCase();
        return parts.join(' > ');
    }

    /**
     * Draw DevTools-style highlight boxes on the canvas for margin, padding,
     * and content areas of the given element.
     */
    function _drawElementHighlight(el) {
        if (!ctx || !canvas) return;
        _redrawAll();

        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);

        var mt = parseFloat(style.marginTop) || 0;
        var mr = parseFloat(style.marginRight) || 0;
        var mb = parseFloat(style.marginBottom) || 0;
        var ml = parseFloat(style.marginLeft) || 0;

        var pt = parseFloat(style.paddingTop) || 0;
        var pr = parseFloat(style.paddingRight) || 0;
        var pb = parseFloat(style.paddingBottom) || 0;
        var pl = parseFloat(style.paddingLeft) || 0;

        var bt = parseFloat(style.borderTopWidth) || 0;
        var br2 = parseFloat(style.borderRightWidth) || 0;
        var bb = parseFloat(style.borderBottomWidth) || 0;
        var bl = parseFloat(style.borderLeftWidth) || 0;

        // Margin box (orange)
        ctx.fillStyle = 'rgba(246, 178, 107, 0.3)';
        ctx.fillRect(
            rect.left - ml,
            rect.top - mt,
            rect.width + ml + mr,
            rect.height + mt + mb
        );

        // Padding box (green) — border-box minus border
        ctx.fillStyle = 'rgba(147, 196, 125, 0.4)';
        ctx.fillRect(
            rect.left + bl,
            rect.top + bt,
            rect.width - bl - br2,
            rect.height - bt - bb
        );

        // Content box (blue) — inside padding
        ctx.fillStyle = 'rgba(111, 168, 220, 0.4)';
        ctx.fillRect(
            rect.left + bl + pl,
            rect.top + bt + pt,
            rect.width - bl - br2 - pl - pr,
            rect.height - bt - bb - pt - pb
        );

        // Blue border outline around element bounds
        ctx.strokeStyle = 'rgba(111, 168, 220, 1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }

    /**
     * Show a floating tooltip above (or below) the hovered element displaying
     * tag#id.class | width x height.
     */
    function _showSelectTooltip(el) {
        _removeSelectTooltip();

        var rect = el.getBoundingClientRect();
        var tag = el.tagName.toLowerCase();
        var label = tag;
        if (el.id) label += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
            var classes = el.className.trim().split(/\s+/);
            for (var i = 0; i < classes.length; i++) {
                if (classes[i]) label += '.' + classes[i];
            }
        }
        label += ' | ' + Math.round(rect.width) + ' x ' + Math.round(rect.height);

        var tip = document.createElement('div');
        tip.setAttribute('data-vm-tooltip', '1');
        tip.textContent = label;
        tip.style.cssText = [
            'position:fixed',
            'z-index:1000001',
            'pointer-events:none',
            'background:rgba(0,0,0,0.85)',
            'color:#fff',
            'font-size:11px',
            'font-family:monospace',
            'padding:3px 8px',
            'border-radius:3px',
            'white-space:nowrap',
            'max-width:400px',
            'overflow:hidden',
            'text-overflow:ellipsis'
        ].join(';');

        // Position above element, or below if too close to top
        var tipH = 22;
        var topPos = rect.top - tipH - 4;
        if (topPos < 4) topPos = rect.bottom + 4;
        tip.style.left = Math.max(0, rect.left) + 'px';
        tip.style.top = topPos + 'px';

        document.body.appendChild(tip);
        _selectTooltip = tip;
    }

    /**
     * Show floating action bar below the selected element with
     * "Send to Chat" and "Cancel" buttons.
     */
    function _showSelectActionBar(el) {
        _removeSelectActionBar();

        var rect = el.getBoundingClientRect();

        var bar = document.createElement('div');
        bar.setAttribute('data-vm-actionbar', '1');
        bar.style.cssText = [
            'position:fixed',
            'z-index:1000001',
            'display:flex',
            'gap:6px',
            'padding:4px 8px',
            'background:rgba(0,0,0,0.9)',
            'border-radius:4px',
            'font-family:sans-serif',
            'font-size:12px'
        ].join(';');

        var btnStyle = [
            'border:none',
            'border-radius:3px',
            'padding:4px 12px',
            'cursor:pointer',
            'font-size:12px',
            'font-family:sans-serif'
        ].join(';');

        var sendBtn = document.createElement('button');
        sendBtn.textContent = 'Send to Chat';
        sendBtn.style.cssText = btnStyle + ';background:#4a9eff;color:#fff;';
        sendBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // Clean up UI but KEEP _selectedElement — the host reads it
            // asynchronously via ExecuteScript after the lens-shortcut fires
            _removeSelectTooltip();
            _removeSelectActionBar();
            _redrawAll();
            _selectMode = false;
            // Notify Tauri host via lens-shortcut scheme (fire-and-forget)
            new Image().src = 'lens-shortcut://element-selected';
        });

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = btnStyle + ';background:#555;color:#fff;';
        cancelBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            _cancelSelect();
        });

        bar.appendChild(sendBtn);
        bar.appendChild(cancelBtn);

        // Stop events from reaching canvas
        bar.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        bar.addEventListener('mousemove', function (e) { e.stopPropagation(); });
        bar.addEventListener('mouseup', function (e) { e.stopPropagation(); });

        // Position below element, or above if too close to bottom
        var barH = 34;
        var topPos = rect.bottom + 4;
        if (topPos + barH > window.innerHeight) topPos = rect.top - barH - 4;
        bar.style.left = Math.max(0, rect.left) + 'px';
        bar.style.top = topPos + 'px';

        document.body.appendChild(bar);
        _selectActionBar = bar;
    }

    /**
     * Serialize a DOM element into a structured object for the host.
     */
    function _serializeElement(el) {
        var selector = _buildSelector(el);
        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);

        // Strip script and style tags from outerHTML
        var clone = el.cloneNode(true);
        var scripts = clone.querySelectorAll('script, style');
        for (var i = 0; i < scripts.length; i++) {
            scripts[i].parentNode.removeChild(scripts[i]);
        }
        var html = clone.outerHTML || '';
        if (html.length > 2000) html = html.substring(0, 2000);

        var text = (el.textContent || '').trim();
        if (text.length > 200) text = text.substring(0, 200);

        var styleProps = [
            'display', 'position', 'width', 'height', 'padding', 'margin',
            'gap', 'flex-direction', 'align-items', 'justify-content',
            'color', 'background', 'background-color', 'border', 'border-radius',
            'box-shadow', 'opacity', 'font-family', 'font-size', 'font-weight',
            'line-height', 'letter-spacing'
        ];
        var styles = {};
        for (var j = 0; j < styleProps.length; j++) {
            var val = style.getPropertyValue(styleProps[j]);
            if (val) styles[styleProps[j]] = val;
        }

        return {
            selector: selector,
            tagName: el.tagName.toLowerCase(),
            id: el.id || '',
            classes: el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(function (c) { return c; }) : [],
            bounds: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            },
            html: html,
            text: text,
            styles: styles
        };
    }

    // --- Select mode mouse / keyboard handlers ---

    function _handleSelectMouseMove(e) {
        if (!_selectMode || _selectedElement) return;

        // Temporarily disable canvas pointer-events so elementFromPoint
        // can hit the actual page elements beneath the overlay
        if (canvas) canvas.style.pointerEvents = 'none';
        var el = document.elementFromPoint(e.clientX, e.clientY);
        if (canvas) canvas.style.pointerEvents = 'auto';

        // Skip our own overlay elements
        if (!el || el === document.body || el === document.documentElement) {
            _hoveredEl = null;
            _removeSelectTooltip();
            _redrawAll();
            return;
        }
        if (el.hasAttribute('data-vm-tooltip') ||
            el.hasAttribute('data-vm-actionbar') ||
            el.hasAttribute('data-vm-text') ||
            el.id === 'vm-design-canvas') {
            return;
        }
        // Also skip if element is a child of our overlay elements
        var parent = el.parentElement;
        while (parent) {
            if (parent.hasAttribute('data-vm-actionbar') ||
                parent.hasAttribute('data-vm-tooltip') ||
                parent.hasAttribute('data-vm-text')) {
                return;
            }
            parent = parent.parentElement;
        }

        // Same element — skip redundant redraws
        if (el === _hoveredEl) return;

        _hoveredEl = el;
        _drawElementHighlight(el);
        _showSelectTooltip(el);
    }

    function _handleSelectMouseDown(e) {
        if (!_selectMode) return;
        e.preventDefault();
        e.stopPropagation();

        // If already selected, clicking again deselects
        if (_selectedElement) {
            _cancelSelect();
            return;
        }

        if (!_hoveredEl) return;

        _selectedElement = _serializeElement(_hoveredEl);
        _drawElementHighlight(_hoveredEl);
        _removeSelectTooltip();
        _showSelectActionBar(_hoveredEl);
    }

    function _handleSelectKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (_selectedElement) {
                _cancelSelect();
            } else {
                _exitSelectMode();
            }
        }
    }

    // --- Select mode cleanup helpers ---

    function _removeSelectTooltip() {
        if (_selectTooltip && _selectTooltip.parentNode) {
            _selectTooltip.parentNode.removeChild(_selectTooltip);
        }
        _selectTooltip = null;
    }

    function _removeSelectActionBar() {
        if (_selectActionBar && _selectActionBar.parentNode) {
            _selectActionBar.parentNode.removeChild(_selectActionBar);
        }
        _selectActionBar = null;
    }

    function _cancelSelect() {
        _selectedElement = null;
        _hoveredEl = null;
        _removeSelectTooltip();
        _removeSelectActionBar();
        _redrawAll();
    }

    function _exitSelectMode() {
        _selectMode = false;
        _cancelSelect();
        if (canvas) canvas.style.cursor = _getCursor(currentTool);
    }

    // =========================================================================
    // Event handlers
    // =========================================================================

    function _handleMouseDown(e) {
        if (_selectMode) { _handleSelectMouseDown(e); return; }
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        var x = e.offsetX;
        var y = e.offsetY;

        // Commit any active text input before starting a new action
        if (textInput && textInput._textarea) {
            textInput._textarea.blur();
        }

        if (currentTool === 'text') {
            _createTextInput(x, y);
            return;
        }

        drawing = true;
        currentStroke = {
            tool: currentTool,
            color: currentColor,
            size: currentTool === 'marker' ? Math.max(currentSize, 15) : currentSize,
            points: [{ x: x, y: y }],
            text: null,
            fontSize: null,
            shift: shiftHeld
        };

        // Two-point tools start with a duplicate endpoint for preview
        if (_isTwoPoint(currentTool)) {
            currentStroke.points.push({ x: x, y: y });
        }
    }

    function _handleMouseMove(e) {
        if (_selectMode) { _handleSelectMouseMove(e); return; }
        if (!drawing || !currentStroke) return;
        e.preventDefault();
        e.stopPropagation();

        var x = e.offsetX;
        var y = e.offsetY;

        currentStroke.shift = shiftHeld;

        if (_isTwoPoint(currentTool)) {
            currentStroke.points[1] = { x: x, y: y };
        } else {
            currentStroke.points.push({ x: x, y: y });
        }

        // Live preview: redraw committed strokes + in-progress stroke
        _redrawAll();
        _drawStroke(currentStroke);
    }

    function _handleMouseUp(e) {
        if (_selectMode) return;
        if (!drawing || !currentStroke) return;
        e.preventDefault();
        e.stopPropagation();

        drawing = false;
        currentStroke.shift = shiftHeld;

        // Finalize pixelate: compute mosaic ImageData
        if (currentStroke.tool === 'pixelate' && currentStroke.points.length >= 2) {
            var p0 = currentStroke.points[0];
            var p1 = currentStroke.points[1];
            var rx = Math.min(p0.x, p1.x);
            var ry = Math.min(p0.y, p1.y);
            var rw = Math.abs(p1.x - p0.x);
            var rh = Math.abs(p1.y - p0.y);
            currentStroke.imageData = _computePixelate(rx, ry, rw, rh);
            // No content to pixelate (canvas is transparent here) — discard
            if (!currentStroke.imageData) {
                currentStroke = null;
                _redrawAll();
                return;
            }
        }

        strokes.push(currentStroke);
        redoStack = [];
        currentStroke = null;
        _redrawAll();
    }

    function _handleKeyDown(e) {
        // Select mode handles its own keys
        if (_selectMode) { _handleSelectKeyDown(e); return; }

        // Don't intercept when typing in text input
        if (textInput) {
            var ta = textInput._textarea || textInput;
            if (document.activeElement === ta) return;
        }

        if (e.key === 'Shift') {
            shiftHeld = true;
            return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            _undo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
            e.preventDefault();
            _redo();
            return;
        }
        if (e.key === 'Escape') {
            if (drawing && currentStroke) {
                drawing = false;
                currentStroke = null;
                _redrawAll();
            }
        }
    }

    function _handleKeyUp(e) {
        if (e.key === 'Shift') {
            shiftHeld = false;
        }
    }

    function _handleResize() {
        if (!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        _redrawAll();
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    function _isTwoPoint(tool) {
        return tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'circle' || tool === 'pixelate';
    }

    function _getCursor(tool) {
        if (tool === 'text') return 'text';
        if (tool === 'select') return 'crosshair';
        return 'crosshair';
    }

    // =========================================================================
    // Undo / Redo
    // =========================================================================

    function _undo() {
        if (strokes.length === 0) return;
        redoStack.push(strokes.pop());
        _redrawAll();
    }

    function _redo() {
        if (redoStack.length === 0) return;
        strokes.push(redoStack.pop());
        _redrawAll();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    window.vmDesign = {
        enable: function () {
            if (canvas) return;

            canvas = document.createElement('canvas');
            canvas.id = 'vm-design-canvas';
            canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;cursor:crosshair;';
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            document.body.appendChild(canvas);
            ctx = canvas.getContext('2d');

            canvas.style.cursor = _getCursor(currentTool);

            _onMouseDown = _handleMouseDown;
            _onMouseMove = _handleMouseMove;
            _onMouseUp = _handleMouseUp;
            _onKeyDown = _handleKeyDown;
            _onKeyUp = _handleKeyUp;
            _onResize = _handleResize;

            canvas.addEventListener('mousedown', _onMouseDown);
            canvas.addEventListener('mousemove', _onMouseMove);
            canvas.addEventListener('mouseup', _onMouseUp);
            window.addEventListener('keydown', _onKeyDown, true);
            window.addEventListener('keyup', _onKeyUp, true);
            window.addEventListener('resize', _onResize);
        },

        disable: function () {
            _exitSelectMode();
            _removeTextInput();

            if (canvas) {
                canvas.removeEventListener('mousedown', _onMouseDown);
                canvas.removeEventListener('mousemove', _onMouseMove);
                canvas.removeEventListener('mouseup', _onMouseUp);
                if (canvas.parentNode) {
                    canvas.parentNode.removeChild(canvas);
                }
            }
            window.removeEventListener('keydown', _onKeyDown, true);
            window.removeEventListener('keyup', _onKeyUp, true);
            window.removeEventListener('resize', _onResize);

            canvas = null;
            ctx = null;
            drawing = false;
            currentStroke = null;
            strokes = [];
            redoStack = [];
        },

        setTool: function (name) {
            var valid = ['pen', 'line', 'arrow', 'rect', 'circle', 'text', 'marker', 'pixelate', 'select'];
            if (valid.indexOf(name) === -1) return;
            // Exit select mode when switching to a different tool
            if (_selectMode && name !== 'select') {
                _exitSelectMode();
            }
            currentTool = name;
            if (name === 'select') {
                _selectMode = true;
                if (canvas) canvas.style.cursor = 'crosshair';
            } else {
                if (canvas) canvas.style.cursor = _getCursor(name);
            }
        },

        setColor: function (hex) {
            if (typeof hex === 'string' && hex.length > 0) {
                currentColor = hex;
            }
        },

        setSize: function (px) {
            var n = parseInt(px, 10);
            if (n >= 1 && n <= 20) {
                currentSize = n;
            }
        },

        undo: function () {
            _undo();
        },

        redo: function () {
            _redo();
        },

        clear: function () {
            strokes = [];
            redoStack = [];
            _redrawAll();
        },

        getStrokeCount: function () {
            return strokes.length;
        },

        toDataURL: function () {
            if (!canvas) return '';
            return canvas.toDataURL('image/png');
        },

        getSelectedElement: function () {
            var data = _selectedElement;
            _selectedElement = null;  // Read-once: clear after retrieval
            return data;
        }
    };
})();
