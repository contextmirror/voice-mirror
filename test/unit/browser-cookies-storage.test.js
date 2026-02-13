const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock cdp module
const mockCdp = {
    sendCommand: mock.fn(async () => ({})),
    onEvent: mock.fn(),
    isAttached: () => true,
    getUrl: async () => 'https://example.com',
    getTitle: async () => 'Test',
    evaluate: mock.fn(async () => ({ result: { value: '' } })),
    getAccessibilityTree: mock.fn(async () => []),
    getWebContents: () => null
};

const Module = require('module');
const originalResolve = Module._resolveFilename;
const cdpPath = require.resolve('../../electron/browser/webview-cdp');
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === './webview-cdp' || request === '../browser/webview-cdp') {
        return cdpPath;
    }
    return originalResolve.call(this, request, parent, ...rest);
};
require.cache[cdpPath] = {
    id: cdpPath,
    filename: cdpPath,
    loaded: true,
    exports: mockCdp
};

const {
    getCookies, setCookie, deleteCookies, clearCookies,
    getStorage, setStorage, deleteStorage, clearStorage
} = require('../../electron/browser/browser-controller');

describe('cookie operations', () => {
    beforeEach(() => {
        mockCdp.sendCommand.mock.resetCalls();
        mockCdp.evaluate.mock.resetCalls();
    });

    describe('getCookies', () => {
        it('enables Network domain and returns cookies', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async (method, params) => {
                if (method === 'Network.getCookies') {
                    return {
                        cookies: [
                            { name: 'session', value: 'abc', domain: '.example.com' },
                            { name: 'prefs', value: 'dark', domain: '.example.com' }
                        ]
                    };
                }
                return {};
            });

            const result = await getCookies({});
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.cookies.length, 2);

            const calls = mockCdp.sendCommand.mock.calls;
            const enableCall = calls.find(c => c.arguments[0] === 'Network.enable');
            assert.ok(enableCall, 'Should enable Network domain');
        });

        it('filters by domain', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async (method) => {
                if (method === 'Network.getCookies') {
                    return {
                        cookies: [
                            { name: 'a', value: '1', domain: '.example.com' },
                            { name: 'b', value: '2', domain: '.other.com' }
                        ]
                    };
                }
                return {};
            });

            const result = await getCookies({ domain: 'example.com' });
            assert.strictEqual(result.cookies.length, 1);
            assert.strictEqual(result.cookies[0].name, 'a');
        });

        it('filters by name', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async (method) => {
                if (method === 'Network.getCookies') {
                    return {
                        cookies: [
                            { name: 'session', value: 'abc', domain: '.example.com' },
                            { name: 'prefs', value: 'dark', domain: '.example.com' }
                        ]
                    };
                }
                return {};
            });

            const result = await getCookies({ name: 'session' });
            assert.strictEqual(result.cookies.length, 1);
            assert.strictEqual(result.cookies[0].value, 'abc');
        });
    });

    describe('setCookie', () => {
        it('passes correct params to Network.setCookie', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async () => ({ success: true }));

            const result = await setCookie({
                name: 'test',
                value: 'val',
                domain: '.example.com',
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'Strict'
            });

            assert.strictEqual(result.ok, true);
            const setCookieCall = mockCdp.sendCommand.mock.calls.find(
                c => c.arguments[0] === 'Network.setCookie'
            );
            assert.ok(setCookieCall);
            const params = setCookieCall.arguments[1];
            assert.strictEqual(params.name, 'test');
            assert.strictEqual(params.value, 'val');
            assert.strictEqual(params.domain, '.example.com');
            assert.strictEqual(params.secure, true);
            assert.strictEqual(params.httpOnly, true);
            assert.strictEqual(params.sameSite, 'Strict');
        });

        it('uses current URL when no url or domain specified', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async () => ({ success: true }));

            await setCookie({ name: 'test', value: 'val' });

            const setCookieCall = mockCdp.sendCommand.mock.calls.find(
                c => c.arguments[0] === 'Network.setCookie'
            );
            assert.ok(setCookieCall);
            assert.strictEqual(setCookieCall.arguments[1].url, 'https://example.com');
        });

        it('throws when name is missing', async () => {
            await assert.rejects(() => setCookie({ value: 'val' }), /name is required/i);
        });
    });

    describe('deleteCookies', () => {
        it('calls Network.deleteCookies with correct filter', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async () => ({}));

            await deleteCookies({ name: 'session', domain: '.example.com' });

            const deleteCall = mockCdp.sendCommand.mock.calls.find(
                c => c.arguments[0] === 'Network.deleteCookies'
            );
            assert.ok(deleteCall);
            assert.strictEqual(deleteCall.arguments[1].name, 'session');
            assert.strictEqual(deleteCall.arguments[1].domain, '.example.com');
        });

        it('throws when name is missing', async () => {
            await assert.rejects(() => deleteCookies({}), /name is required/i);
        });
    });

    describe('clearCookies', () => {
        it('gets all cookies then deletes each', async () => {
            const cookies = [
                { name: 'a', domain: '.example.com', path: '/' },
                { name: 'b', domain: '.other.com', path: '/' }
            ];
            mockCdp.sendCommand.mock.mockImplementation(async (method) => {
                if (method === 'Network.getCookies') return { cookies };
                return {};
            });

            const result = await clearCookies();
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.deleted, 2);

            const deleteCalls = mockCdp.sendCommand.mock.calls.filter(
                c => c.arguments[0] === 'Network.deleteCookies'
            );
            assert.strictEqual(deleteCalls.length, 2);
        });
    });
});

describe('storage operations', () => {
    beforeEach(() => {
        mockCdp.sendCommand.mock.resetCalls();
        mockCdp.evaluate.mock.resetCalls();
    });

    describe('getStorage', () => {
        it('reads all localStorage entries', async () => {
            mockCdp.evaluate.mock.mockImplementation(async () => ({
                result: { value: JSON.stringify({ theme: 'dark', lang: 'en' }) }
            }));

            const result = await getStorage({ type: 'localStorage' });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.count, 2);
            assert.strictEqual(result.entries.theme, 'dark');
        });

        it('reads a single key', async () => {
            mockCdp.evaluate.mock.mockImplementation(async () => ({
                result: { value: 'dark' }
            }));

            const result = await getStorage({ type: 'localStorage', key: 'theme' });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.key, 'theme');
            assert.strictEqual(result.value, 'dark');
        });

        it('throws for invalid storage type', async () => {
            await assert.rejects(
                () => getStorage({ type: 'badType' }),
                /Invalid storage type/
            );
        });
    });

    describe('setStorage', () => {
        it('writes localStorage via evaluate', async () => {
            mockCdp.evaluate.mock.mockImplementation(async () => ({ result: { value: undefined } }));

            const result = await setStorage({ type: 'localStorage', key: 'theme', value: 'dark' });
            assert.strictEqual(result.ok, true);

            const evalCalls = mockCdp.evaluate.mock.calls;
            assert.ok(evalCalls.length > 0);
            const expr = evalCalls[0].arguments[0];
            assert.ok(expr.includes('localStorage.setItem'), 'Should call setItem');
            assert.ok(expr.includes('theme'), 'Should include key');
            assert.ok(expr.includes('dark'), 'Should include value');
        });

        it('throws when key is missing', async () => {
            await assert.rejects(
                () => setStorage({ type: 'localStorage', value: 'v' }),
                /key is required/i
            );
        });
    });

    describe('deleteStorage', () => {
        it('calls removeItem via evaluate', async () => {
            mockCdp.evaluate.mock.mockImplementation(async () => ({ result: { value: undefined } }));

            const result = await deleteStorage({ type: 'sessionStorage', key: 'token' });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.type, 'sessionStorage');

            const expr = mockCdp.evaluate.mock.calls[0].arguments[0];
            assert.ok(expr.includes('sessionStorage.removeItem'), 'Should call removeItem');
        });
    });

    describe('clearStorage', () => {
        it('calls clear() via evaluate', async () => {
            mockCdp.evaluate.mock.mockImplementation(async () => ({ result: { value: undefined } }));

            const result = await clearStorage({ type: 'localStorage' });
            assert.strictEqual(result.ok, true);

            const expr = mockCdp.evaluate.mock.calls[0].arguments[0];
            assert.ok(expr.includes('localStorage.clear()'), 'Should call clear()');
        });

        it('throws for invalid storage type', async () => {
            await assert.rejects(
                () => clearStorage({ type: 'invalid' }),
                /Invalid storage type/
            );
        });
    });
});
