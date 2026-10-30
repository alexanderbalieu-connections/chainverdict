// Reject unusable path inputs before the payment middleware sees an authorization.
// Identifier validators still sell checks of concrete values, including invalid
// checksums. Do not turn those product results into a prepayment syntax policy.
export function rejectInvalidPaidPath(metadata) {
  const routes = Object.entries(metadata).filter(([, m]) => m.p).map(([route, meta]) => ({
    prefix: route.split(' ')[1].replace(/\*$/, ''), meta,
  }));
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    for (const {prefix, meta} of routes) {
      if (!req.path.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      let value;
      try { value = decodeURIComponent(req.path.slice(prefix.length).replace(/\/$/, '')); }
      catch { value = ''; }
      const placeholder = !value || /[\/\\]/.test(value) || /^(?:[:*]|\{|<)/.test(value) || /^(?:YOUR_[A-Z_]+|REPLACE_ME)$/i.test(value);
      const addressRoute = ['address', 'addr'].includes(meta.p);
      const malformed = placeholder || (addressRoute && !/^0x[0-9a-f]{40}$/i.test(value)) || (meta.p === 'tx' && !/^0x[0-9a-f]{64}$/i.test(value));
      if (malformed) return res.status(400).set('Cache-Control', 'no-store').json({
        error: 'invalid_path_parameter', parameter: meta.p,
        message: 'Supply a concrete path value before authorizing payment.',
        exampleUrl: 'https://chainverdict.xyz' + prefix + encodeURIComponent(meta.ex),
      });
      return next();
    }
    next();
  };
}
