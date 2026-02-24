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

        // Multiline support
        var lines = stroke.text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], p.x, p.y + i * stroke.fontSize * 1.2);
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
    // Text input overlay
    // =========================================================================

    function _createTextInput(x, y) {
        _removeTextInput();

        var fontSize = currentSize * 4 + 8;
        var ta = document.createElement('textarea');
        ta.style.cssText = [
            'position:fixed',
            'left:' + x + 'px',
            'top:' + y + 'px',
            'min-width:100px',
            'min-height:' + (fontSize + 8) + 'px',
            'background:transparent',
            'border:1px dashed ' + currentColor,
            'outline:none',
            'color:' + currentColor,
            'font-size:' + fontSize + 'px',
            'font-family:sans-serif',
            'line-height:1.2',
            'padding:2px 4px',
            'resize:none',
            'z-index:1000000',
            'overflow:hidden',
            'white-space:pre-wrap',
            'word-wrap:break-word'
        ].join(';');

        ta.rows = 1;
        ta.setAttribute('data-vm-text', '1');

        var commitColor = currentColor;
        var commitFontSize = fontSize;
        var commitX = x;
        var commitY = y;
        var committed = false;

        function commit() {
            if (committed) return;
            committed = true;
            var val = ta.value;
            _removeTextInput();
            if (val.length === 0) return;
            strokes.push({
                tool: 'text',
                color: commitColor,
                size: commitFontSize,
                points: [{ x: commitX, y: commitY }],
                text: val,
                fontSize: commitFontSize
            });
            redoStack = [];
            _redrawAll();
        }

        ta.addEventListener('blur', commit);
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ta.blur();
            }
            if (e.key === 'Escape') {
                ta.value = '';
                ta.blur();
            }
            // Auto-resize
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
            e.stopPropagation();
        });
        ta.addEventListener('input', function () {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        });

        document.body.appendChild(ta);
        textInput = ta;
        // Defer focus so mouseup doesn't steal it
        setTimeout(function () { ta.focus(); }, 0);
    }

    function _removeTextInput() {
        if (textInput && textInput.parentNode) {
            textInput.parentNode.removeChild(textInput);
        }
        textInput = null;
    }

    // =========================================================================
    // Event handlers
    // =========================================================================

    function _handleMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        var x = e.offsetX;
        var y = e.offsetY;

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
        // Don't intercept when typing in text input
        if (textInput && document.activeElement === textInput) return;

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
            var valid = ['pen', 'line', 'arrow', 'rect', 'circle', 'text', 'marker', 'pixelate'];
            if (valid.indexOf(name) === -1) return;
            currentTool = name;
            if (canvas) {
                canvas.style.cursor = _getCursor(name);
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
        }
    };
})();
