// Cache only the immutable, source-hosted question data in the learner's browser.
const CACHE_NAME = "jiakao-source-data-v1";

function alternateSource(url) {
  const match = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  return match ? `https://cdn.jsdelivr.net/gh/${match[1]}/${match[2]}@${match[3]}/${match[4]}` : null;
}

export async function loadJSON(url, { validate = () => true, cache = false, onStatus = () => {} } = {}) {
  const key = new URL(url, location.href).href;
  let storage;
  if (cache && globalThis.caches) {
    try {
      storage = await caches.open(CACHE_NAME);
      const saved = await storage.match(key);
      if (saved) {
        const data = await saved.json();
        if (validate(data)) return data;
        await storage.delete(key);
      }
    } catch { /* Browsing modes may disable cache storage. Network still works. */ }
  }

  const controllers = [];
  let fallbackTimer;
  const request = async source => {
    const controller = new AbortController();
    controllers.push(controller);
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(source, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!validate(data)) throw new Error("题库数据格式不完整");
      return data;
    } finally { clearTimeout(timeout); }
  };

  try {
    const alternate = alternateSource(key);
    const pending = [request(key)];
    if (alternate) pending.push(new Promise((resolve, reject) => {
      fallbackTimer = setTimeout(() => {
        onStatus("正在尝试备用数据线路…");
        request(alternate).then(resolve, reject);
      }, 4000);
    }));
    const data = await Promise.any(pending);
    if (storage) {
      // A failed cache write must never prevent a practice session.
      storage.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } })).catch(() => {});
    }
    return data;
  } catch {
    throw new Error(navigator.onLine === false ? "网络已断开，连接网络后可重试" : "题库暂时无法连接，请重试");
  } finally {
    clearTimeout(fallbackTimer);
    controllers.forEach(controller => controller.abort());
  }
}

export function mediaSources(url) {
  const alternate = alternateSource(url);
  return alternate ? [url, alternate] : [url];
}
