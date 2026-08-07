// Tiny hash router — no dependencies, no build step.

const routes = [];

export function route(pattern, handler) {
  const paramNames = [];
  const regex = new RegExp(
    '^' +
      pattern.replace(/:[^/]+/g, (m) => {
        paramNames.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ regex, paramNames, handler });
}

export function navigate(path) {
  window.location.hash = path;
}

async function resolve() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  for (const r of routes) {
    const match = hash.match(r.regex);
    if (match) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
      await r.handler(params);
      return;
    }
  }
  navigate('/');
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
