# electron/browser/

CDP-based web browser automation via an Electron `<webview>` tag.
No external Chrome process -- all control goes through the webview's
`webContents.debugger` API.

## Architecture

```
browser-controller.js  -->  webview-cdp.js  -->  Electron webContents.debugger
        |                        ^
        v                        |
webview-actions.js          webview-snapshot.js
(click, type, press, ...)   (accessibility tree + role refs)
```

1. **webview-cdp.js** bridges Electron's debugger API to a CDP interface.
2. **browser-controller.js** manages lifecycle, navigation, cookies, storage.
3. **webview-snapshot.js** builds page snapshots (ARIA tree or role-ref tree).
4. **webview-actions.js** resolves element refs and dispatches input via CDP.

## File index

| Module | Description |
|---|---|
| `index.js` | Barrel -- exports `webSearch` and `fetchUrl` |
| `browser-controller.js` | Webview lifecycle, navigation, cookies, web storage, console tracking |
| `webview-cdp.js` | CDP adapter: attach/detach debugger, sendCommand, evaluate, screenshot |
| `webview-snapshot.js` | Page snapshots in ARIA or role-ref format; DOM fallback extraction |
| `webview-actions.js` | Input actions (click, type, fill, press, drag, hover, wait, etc.) |
| `role-refs.js` | Parses accessibility snapshots into numbered `e1`/`e2` element refs |
| `browser-search.js` | Google search via webview navigation + result extraction |
| `browser-fetch.js` | URL content fetching: navigates webview and extracts page text |
| `search-utils.js` | Shared search-result formatting helper |
