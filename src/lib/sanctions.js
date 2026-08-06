// OFAC SDN digital-currency-address screening.
// Source: community-maintained mirror of the official OFAC SDN list (0xB10C),
// regenerated automatically from treasury.gov data. Loaded at boot, refreshed daily.
import { isAddress, getAddress } from "viem";

const SOURCES = [
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt",
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_USDC.txt",
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_USDT.txt"
];

let SET = new Set();
let loadedAt = null;
let lastError = null;

export async function refreshSanctions() {
  try {
    const texts = await Promise.all(SOURCES.map(u =>
      fetch(u, { signal: AbortSignal.timeout(15000) }).then(r => {
        if (!r.ok) throw new Error(`${r.status} for ${u}`);
        return r.text();
      })
    ));
    const next = new Set();
    for (const t of texts)
      for (const line of t.split("\n")) {
        const a = line.trim().toLowerCase();
        if (/^0x[0-9a-f]{40}$/.test(a)) next.add(a);
      }
    if (next.size === 0) throw new Error("empty list");
    SET = next; loadedAt = new Date().toISOString(); lastError = null;
    console.log(`sanctions list loaded: ${SET.size} addresses`);
  } catch (e) {
    lastError = String(e.message || e);
    console.error("sanctions refresh failed:", lastError);
  }
}

export function startSanctionsRefresher() {
  refreshSanctions();
  setInterval(refreshSanctions, 24 * 60 * 60 * 1000).unref();
}

export function screenAddress(raw) {
  if (!isAddress(raw)) return { error: "invalid_address", input: raw };
  if (SET.size === 0) return {
    input: raw, status: "unavailable",
    note: "Sanctions list not loaded yet — retry shortly.", last_error: lastError
  };
  const addr = getAddress(raw);
  const hit = SET.has(addr.toLowerCase());
  return {
    address: addr,
    sanctioned_match: hit,
    result: hit ? "MATCH_OFAC_SDN" : "no_match",
    list: "OFAC SDN digital currency addresses (ETH/USDC/USDT entries; EVM addresses apply across EVM chains incl. Base)",
    list_size: SET.size,
    list_loaded_at: loadedAt,
    disclaimer: "Screening against the public OFAC SDN digital-currency list only. Not a complete compliance program, not legal advice; no fuzzy entity matching. Absence of a match is not clearance."
  };
}
