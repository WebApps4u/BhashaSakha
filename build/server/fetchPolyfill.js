import http from 'http';
import https from 'https';
class HeadersPolyfill {
    constructor(init) {
        Object.defineProperty(this, "map", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.map = new Map();
        if (!init)
            return;
        if (Array.isArray(init)) {
            for (const [k, v] of init)
                this.set(k, v);
            return;
        }
        for (const [k, v] of Object.entries(init)) {
            if (typeof v === 'string')
                this.set(k, v);
        }
    }
    norm(key) {
        return String(key).toLowerCase();
    }
    append(key, value) {
        const k = this.norm(key);
        const existing = this.map.get(k);
        this.map.set(k, existing ? `${existing}, ${value}` : String(value));
    }
    set(key, value) {
        this.map.set(this.norm(key), String(value));
    }
    get(key) {
        return this.map.get(this.norm(key)) ?? null;
    }
    has(key) {
        return this.map.has(this.norm(key));
    }
    delete(key) {
        this.map.delete(this.norm(key));
    }
    entries() {
        return this.map.entries();
    }
    [Symbol.iterator]() {
        return this.entries();
    }
    forEach(callback) {
        for (const [k, v] of this.map.entries())
            callback(v, k);
    }
}
const fetchImpl = (input, init = {}) => {
    const url = new URL(input);
    const isHttps = url.protocol === 'https:';
    const reqFn = isHttps ? https.request : http.request;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = init.headers ?? {};
    const body = init.body ?? '';
    return new Promise((resolve, reject) => {
        const req = reqFn({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port ? Number(url.port) : undefined,
            path: `${url.pathname}${url.search}`,
            method,
            headers: {
                ...headers,
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => {
                const status = res.statusCode ?? 0;
                const raw = Buffer.concat(chunks).toString('utf8');
                const headers = new HeadersPolyfill();
                for (const [k, v] of Object.entries(res.headers ?? {})) {
                    if (!k)
                        continue;
                    if (Array.isArray(v))
                        headers.set(k, v.join(', '));
                    else if (typeof v === 'string')
                        headers.set(k, v);
                }
                const base = {
                    ok: status >= 200 && status < 300,
                    status,
                    statusText: res.statusMessage ?? '',
                    headers,
                    text: async () => raw,
                    json: async () => {
                        try {
                            return JSON.parse(raw);
                        }
                        catch {
                            return null;
                        }
                    },
                    clone: () => base,
                };
                resolve(base);
            });
        });
        req.on('error', reject);
        if (body)
            req.write(body);
        req.end();
    });
};
if (!globalThis.fetch) {
    globalThis.fetch = ((input, init) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? '');
        const headers = {};
        const rawHeaders = init?.headers ?? {};
        if (Array.isArray(rawHeaders)) {
            for (const pair of rawHeaders) {
                if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string')
                    headers[pair[0]] = pair[1];
            }
        }
        else if (rawHeaders && typeof rawHeaders.forEach === 'function') {
            rawHeaders.forEach((value, key) => {
                if (typeof key === 'string' && typeof value === 'string')
                    headers[key] = value;
            });
        }
        else if (rawHeaders && typeof rawHeaders === 'object') {
            for (const [k, v] of Object.entries(rawHeaders)) {
                if (typeof v === 'string')
                    headers[k] = v;
            }
        }
        return fetchImpl(url, { method: init?.method, headers, body: typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '' });
    });
}
if (!globalThis.Headers) {
    globalThis.Headers = HeadersPolyfill;
}
//# sourceMappingURL=fetchPolyfill.js.map