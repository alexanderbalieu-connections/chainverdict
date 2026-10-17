// Shared by HEAD protection and settlement attribution. The SDK includes the bare
// prefix of a trailing /* key. Prefer specific keys over broader wildcard keys.
export function paidRouteMatchers(routeKeys) {
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return routeKeys.map(key => {
    const [method, ...parts] = key.split(' '); const path = parts.join(' ');
    const base = path.endsWith('/*') ? path.slice(0, -2) : path;
    const pattern = base.split('*').map(escape).join('.*') + (path.endsWith('/*') ? '(?:/.*)?' : '');
    return { key, method, pattern: new RegExp('^' + pattern + '/?$', 'i'), specificity: path.replaceAll('*', '').length };
  }).sort((a, b) => b.specificity - a.specificity);
}
