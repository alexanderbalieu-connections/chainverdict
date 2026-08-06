// On-chain reads for token verdicts & wallet dossiers. Data source = Base RPC (self-updating).
import { createPublicClient, http, formatUnits, isAddress, getAddress } from "viem";
import { base } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const client = createPublicClient({ chain: base, transport: http(RPC_URL, { timeout: 8000 }) });

const ERC20_ABI = [
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
];

// 4-byte selectors whose presence in bytecode signals risk capabilities
const RISK_SELECTORS = {
  mint: ["40c10f19", "a0712d68"],               // mint(address,uint256), mint(uint256)
  pause: ["8456cb59"],                            // pause()
  blacklist: ["f9f92be4", "44337ea1", "1e89d545"],// blacklist variants
  setFees: ["8c0b5e22", "b515566a", "e6c75f71"], // fee setter variants (heuristic)
  proxy: ["3659cfe6", "4f1ef286"]                 // upgradeTo, upgradeToAndCall
};
const DEAD = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead"
]);

async function tryRead(address, functionName) {
  try { return await client.readContract({ address, abi: ERC20_ABI, functionName }); }
  catch { return null; }
}

export async function tokenVerdict(rawAddress) {
  if (!isAddress(rawAddress)) return { error: "invalid_address", input: rawAddress };
  const address = getAddress(rawAddress);
  const bytecode = await client.getCode({ address });
  if (!bytecode || bytecode === "0x") {
    return { address, verdict: "avoid", score: 0, reason: "no_contract_at_address" };
  }
  const code = bytecode.toLowerCase();
  const flags = {};
  for (const [flag, selectors] of Object.entries(RISK_SELECTORS)) {
    flags[flag] = selectors.some(sel => code.includes(sel));
  }
  const [name, symbol, decimals, totalSupply, owner] = await Promise.all([
    tryRead(address, "name"), tryRead(address, "symbol"),
    tryRead(address, "decimals"), tryRead(address, "totalSupply"),
    tryRead(address, "owner")
  ]);
  const renounced = owner ? DEAD.has(owner.toLowerCase()) : null;

  let score = 100;
  const reasons = [];
  if (flags.mint) { score -= 25; reasons.push("mint_capability_in_bytecode"); }
  if (flags.pause) { score -= 15; reasons.push("pausable"); }
  if (flags.blacklist) { score -= 25; reasons.push("blacklist_capability"); }
  if (flags.proxy) { score -= 20; reasons.push("upgradeable_proxy_pattern"); }
  if (owner && renounced === false) { score -= 15; reasons.push("owner_not_renounced"); }
  if (owner && renounced === true) { score += 10; reasons.push("ownership_renounced"); }
  if (!name || !symbol) { score -= 10; reasons.push("missing_erc20_metadata"); }
  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 70 ? "hold" : score >= 40 ? "caution" : "avoid";

  return {
    chain: "base", address, verdict, score, reasons,
    token: {
      name, symbol,
      decimals: decimals ?? null,
      total_supply: totalSupply != null && decimals != null ? formatUnits(totalSupply, decimals) : null
    },
    capabilities: flags,
    owner: owner ?? null, ownership_renounced: renounced,
    disclaimer: "Heuristic bytecode/state analysis. Not financial advice. Absence of flags is not proof of safety.",
    checked_at: new Date().toISOString()
  };
}

export async function walletDossier(rawAddress) {
  if (!isAddress(rawAddress)) return { error: "invalid_address", input: rawAddress };
  const address = getAddress(rawAddress);
  const [balance, txCount, code, blockNumber] = await Promise.all([
    client.getBalance({ address }),
    client.getTransactionCount({ address }),
    client.getCode({ address }),
    client.getBlockNumber()
  ]);
  const isContract = !!code && code !== "0x";
  const flags = [];
  if (txCount === 0 && balance === 0n) flags.push("unused_address");
  if (txCount === 0 && balance > 0n) flags.push("funded_never_spent");
  if (!isContract && txCount > 5000) flags.push("very_high_activity_possible_bot_or_exchange");
  return {
    chain: "base", address,
    type: isContract ? "contract" : "eoa",
    eth_balance: formatUnits(balance, 18),
    nonce_tx_count: txCount,
    activity_band: txCount === 0 ? "none" : txCount < 10 ? "low" : txCount < 500 ? "medium" : "high",
    flags,
    as_of_block: blockNumber.toString(),
    checked_at: new Date().toISOString()
  };
}
