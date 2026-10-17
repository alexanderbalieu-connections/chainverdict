import { AsyncLocalStorage } from 'node:async_hooks';
import { paidRouteMatchers } from './paid-route-matchers.js';

// Private operational evidence, not a public customer/revenue counter. Independent
// services vendor this small module deliberately; keep its regression tests aligned.
// Transaction hashes can reveal the payer and amount on-chain: keep logs private.
export function settlementEvidence({ service, routeKeys, log = console.log, now = () => new Date().toISOString() }) {
  const context = new AsyncLocalStorage();
  const routes = paidRouteMatchers(routeKeys);
  const emit = ctx => {
    if (!ctx || ctx.emitted || !ctx.finished || !ctx.settlement) return;
    ctx.emitted = true;
    try {
      log(JSON.stringify({ event: 'chainverdict.settlement.v1', at: now(), service,
        route: ctx.route, transaction: ctx.settlement.transaction,
        network: ctx.settlement.network, httpStatus: ctx.status,
        responseFinished: ctx.finished === 'finish',
        outcome: ctx.finished === 'finish' && ctx.status >= 200 && ctx.status < 300
          ? 'settled_response_finished' : 'settled_response_failed_or_aborted' }));
    } catch { /* Evidence must never interrupt payment or delivery. */ }
  };
  return {
    middleware(req, res, next) {
      const route = routes.find(r => req.method === r.method && r.pattern.test(req.path));
      if (!route) return next();
      const ctx = { route: route.key };
      let completed = false;
      const finish = outcome => {
        if (completed) return;
        completed = true;
        ctx.finished = outcome; ctx.status = res.headersSent ? res.statusCode : null; emit(ctx);
      };
      res.once('finish', () => finish('finish'));
      res.once('close', () => finish(res.writableFinished ? 'finish' : 'close'));
      return context.run(ctx, next);
    },
    attach(server) {
      server.onAfterSettle(async ({ result }) => {
        const ctx = context.getStore();
        if (!result?.success || !/^0x[0-9a-fA-F]{64}$/.test(result.transaction || '') ||
            !/^eip155:\d+$/.test(result.network || '')) return;
        if (!ctx) {
          try { log(JSON.stringify({ event: 'chainverdict.settlement.v1', at: now(), service, route: null,
            transaction: result.transaction.toLowerCase(), network: result.network, httpStatus: null,
            responseFinished: null, outcome: 'uncorrelated_settlement' })); } catch {}
          return;
        }
        ctx.settlement = { transaction: result.transaction.toLowerCase(), network: result.network };
        emit(ctx);
      });
    },
  };
}
