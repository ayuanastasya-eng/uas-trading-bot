'use strict';
// Penyimpanan state + log. Produksi: Upstash Redis (REST). Tes lokal: memori.

function upstashStore(url, token) {
  const base = url.replace(/\/$/, '');
  async function post(path, body) {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('Upstash HTTP ' + r.status);
    return r.json();
  }
  async function cmd(...args) {
    const j = await post('', args.map(String));
    if (j.error) throw new Error('Upstash: ' + j.error);
    return j.result;
  }
  return {
    get: (k) => cmd('GET', k),
    async set(k, v, o = {}) {
      const a = ['SET', k, v];
      if (o.ex) a.push('EX', o.ex);
      if (o.nx) a.push('NX');
      return (await cmd(...a)) === 'OK';
    },
    del: (k) => cmd('DEL', k),
    rpush: (k, v) => cmd('RPUSH', k, v),
    lrange: (k, s, e) => cmd('LRANGE', k, s, e),
    llen: (k) => cmd('LLEN', k),
    async multi(cmds) {
      if (!cmds.length) return [];
      const j = await post('/pipeline', cmds.map((c) => c.map(String)));
      j.forEach((x) => {
        if (x.error) throw new Error('Upstash: ' + x.error);
      });
      return j.map((x) => x.result);
    },
  };
}

function memoryStore() {
  const kv = new Map();
  const lists = new Map();
  const list = (k) => {
    if (!lists.has(k)) lists.set(k, []);
    return lists.get(k);
  };
  const api = {
    async get(k) {
      return kv.has(k) ? kv.get(k) : null;
    },
    async set(k, v, o = {}) {
      if (o.nx && kv.has(k)) return false;
      kv.set(k, String(v));
      return true;
    },
    async del(k) {
      return kv.delete(k) ? 1 : 0;
    },
    async rpush(k, v) {
      return list(k).push(String(v));
    },
    async lrange(k, s, e) {
      const a = list(k);
      const n = a.length;
      const from = s < 0 ? Math.max(n + s, 0) : s;
      const to = e < 0 ? n + e : e;
      return a.slice(from, to + 1);
    },
    async llen(k) {
      return list(k).length;
    },
    async multi(cmds) {
      const out = [];
      for (const [c, ...a] of cmds) {
        if (c === 'RPUSH') out.push(await api.rpush(a[0], a[1]));
        else throw new Error('multi: perintah tidak didukung di memori: ' + c);
      }
      return out;
    },
  };
  return api;
}

function makeStore(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('storage_not_configured: isi UPSTASH_REDIS_REST_URL dan UPSTASH_REDIS_REST_TOKEN');
  return upstashStore(url, token);
}

module.exports = { makeStore, memoryStore, upstashStore };
