// Institutional-grade deterministic validators + on-chain payment verification.
import { createPublicClient, http, formatUnits, isAddress, getAddress, parseAbiItem } from "viem";
import { base } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const client = createPublicClient({ chain: base, transport: http(RPC_URL, { timeout: 8000 }) });

// ---- LEI: ISO 17442 (20 chars, mod-97-10 like IBAN) ----
export function validateLEI(input) {
  const lei = String(input || "").replace(/\s+/g, "").toUpperCase();
  const res = { input, normalized: lei, valid: false, checks: {} };
  res.checks.format = /^[A-Z0-9]{18}[0-9]{2}$/.test(lei);
  if (!res.checks.format) return { ...res, reason: "format_invalid_expected_20_alphanumeric" };
  const numeric = lei.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) rem = Number(String(rem) + numeric.slice(i, i + 7)) % 97;
  res.checks.mod97 = rem === 1;
  res.valid = res.checks.mod97;
  if (res.valid) res.parts = { lou_prefix: lei.slice(0, 4), entity_part: lei.slice(4, 18), check_digits: lei.slice(18) };
  else res.reason = "checksum_failed";
  return res;
}

// ---- ISIN: ISO 6166 (12 chars, Luhn over letter-expanded digits) ----
export function validateISIN(input) {
  const isin = String(input || "").replace(/\s+/g, "").toUpperCase();
  const res = { input, normalized: isin, valid: false, checks: {} };
  res.checks.format = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);
  if (!res.checks.format) return { ...res, reason: "format_invalid_expected_12_chars" };
  const expanded = isin.slice(0, 11).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let sum = 0, dbl = true; // rightmost expanded digit is doubled
  for (let i = expanded.length - 1; i >= 0; i--) {
    let d = Number(expanded[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  const check = (10 - (sum % 10)) % 10;
  res.checks.luhn = check === Number(isin[11]);
  res.valid = res.checks.luhn;
  if (res.valid) res.parts = { country: isin.slice(0, 2), nsin: isin.slice(2, 11), check_digit: isin[11] };
  else res.reason = "checksum_failed";
  return res;
}

// ---- Canonical token registry (Base mainnet) — anti-phishing verification ----
const CANONICAL_BASE = {
  USDC:  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, issuer: "Circle" },
  EURC:  { address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", decimals: 6, issuer: "Circle" },
  WETH:  { address: "0x4200000000000000000000000000000000000006", decimals: 18, issuer: "Base (native bridge)" },
  CBBTC: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, issuer: "Coinbase" },
  USDT:  { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, issuer: "Tether (bridged)" }
};
export function verifyToken(query) {
  const q = String(query || "").trim();
  if (isAddress(q)) {
    const addr = getAddress(q);
    const hit = Object.entries(CANONICAL_BASE).find(([, v]) => v.address.toLowerCase() === addr.toLowerCase());
    return hit
      ? { chain: "base", input: q, canonical: true, symbol: hit[0], ...hit[1] }
      : { chain: "base", input: q, canonical: false,
          warning: "Address is NOT in the canonical registry for Base. Verify independently before transacting.",
          registry: Object.keys(CANONICAL_BASE) };
  }
  const sym = q.toUpperCase();
  if (CANONICAL_BASE[sym]) return { chain: "base", input: q, canonical: true, symbol: sym, ...CANONICAL_BASE[sym] };
  return { chain: "base", input: q, canonical: false, error: "unknown_symbol", registry: Object.keys(CANONICAL_BASE) };
}

// ---- On-chain payment verification: decode ERC-20 transfers in a tx ----
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
export async function verifyPayment(txHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) return { error: "invalid_tx_hash", input: txHash };
  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) return { chain: "base", tx: txHash, found: false, note: "Transaction not found (wrong hash, wrong chain, or not yet indexed)." };
  const head = await client.getBlockNumber();
  const transfers = [];
  for (const log of receipt.logs) {
    if (log.topics?.[0] !== "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") continue;
    try {
      const tokenMeta = Object.entries(CANONICAL_BASE).find(([, v]) => v.address.toLowerCase() === log.address.toLowerCase());
      const from = getAddress("0x" + log.topics[1].slice(26));
      const to = getAddress("0x" + log.topics[2].slice(26));
      const value = BigInt(log.data);
      transfers.push({
        token_address: getAddress(log.address),
        token_symbol: tokenMeta ? tokenMeta[0] : null,
        canonical_token: !!tokenMeta,
        from, to,
        amount: tokenMeta ? formatUnits(value, tokenMeta[1].decimals) : value.toString() + " (raw, unknown decimals)"
      });
    } catch { /* skip undecodable */ }
  }
  return {
    chain: "base", tx: txHash, found: true,
    status: receipt.status,
    block: receipt.blockNumber.toString(),
    confirmations: Number(head - receipt.blockNumber),
    erc20_transfers: transfers,
    checked_at: new Date().toISOString()
  };
}
