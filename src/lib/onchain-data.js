// On-chain data pack — everything computed directly from Base RPC. No third-party API, no upstream key.
import { createPublicClient, http, formatUnits, formatEther, isAddress, getAddress, parseAbiItem } from "viem";
import { base } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const client = createPublicClient({ chain: base, transport: http(RPC_URL, { timeout: 9000 }) });

const ERC20 = [
  { name:"name",type:"function",stateMutability:"view",inputs:[],outputs:[{type:"string"}] },
  { name:"symbol",type:"function",stateMutability:"view",inputs:[],outputs:[{type:"string"}] },
  { name:"decimals",type:"function",stateMutability:"view",inputs:[],outputs:[{type:"uint8"}] },
  { name:"totalSupply",type:"function",stateMutability:"view",inputs:[],outputs:[{type:"uint256"}] },
  { name:"balanceOf",type:"function",stateMutability:"view",inputs:[{type:"address"}],outputs:[{type:"uint256"}] }
];
const DEAD = ["0x0000000000000000000000000000000000000000","0x000000000000000000000000000000000000dEaD"];

// ---- Gas oracle: current Base gas conditions, agent-friendly ----
export async function gasOracle() {
  const [block, feeHistory] = await Promise.all([
    client.getBlock(),
    client.getFeeHistory({ blockCount: 5, rewardPercentiles: [10, 50, 90] }).catch(() => null)
  ]);
  const base = block.baseFeePerGas ?? 0n;
  const gwei = (v) => Number(formatUnits(v, 9));
  let priority = { p10: null, p50: null, p90: null };
  if (feeHistory?.reward?.length) {
    const last = feeHistory.reward[feeHistory.reward.length - 1];
    priority = { p10: gwei(last[0]), p50: gwei(last[1]), p90: gwei(last[2]) };
  }
  const suggested = base + (feeHistory?.reward?.at(-1)?.[1] ?? 1000000n); // base + median tip
  // Rough cost of a simple ERC-20 transfer (~50k gas) in USD, assuming ETH price is unknown → give in ETH.
  const transferGas = 50000n;
  return {
    chain: "base",
    block: Number(block.number),
    base_fee_gwei: gwei(base),
    priority_fee_gwei: priority,
    suggested_max_fee_gwei: gwei(suggested),
    est_erc20_transfer_fee_eth: formatEther(suggested * transferGas),
    congestion: gwei(base) < 0.05 ? "low" : gwei(base) < 0.2 ? "moderate" : "high",
    note: "Fees in gwei/ETH. Multiply est fee by current ETH/USD (fetch separately) for USD cost.",
    checked_at: new Date().toISOString()
  };
}

// ---- Token supply & distribution snapshot (holders of known burn addrs, supply math) ----
export async function tokenSupply(rawAddress) {
  if (!isAddress(rawAddress)) return { error: "invalid_address", input: rawAddress };
  const address = getAddress(rawAddress);
  const code = await client.getCode({ address });
  if (!code || code === "0x") return { error: "not_a_contract", address };
  const rd = (fn, args) => client.readContract({ address, abi: ERC20, functionName: fn, args }).catch(() => null);
  const [name, symbol, decimals, total, ...burned] = await Promise.all([
    rd("name"), rd("symbol"), rd("decimals"), rd("totalSupply"),
    ...DEAD.map(d => rd("balanceOf", [d]))
  ]);
  if (decimals == null || total == null) return { error: "not_erc20_compatible", address };
  const dec = Number(decimals);
  const burnedTotal = burned.reduce((s, b) => s + (b ?? 0n), 0n);
  const circulating = total - burnedTotal;
  return {
    chain: "base", address,
    token: { name, symbol, decimals: dec },
    total_supply: formatUnits(total, dec),
    burned_supply: formatUnits(burnedTotal, dec),
    circulating_supply: formatUnits(circulating, dec),
    burned_pct: total > 0n ? Number((burnedTotal * 10000n) / total) / 100 : 0,
    checked_at: new Date().toISOString()
  };
}

// ---- Transfer activity: count + volume of a token's transfers over recent blocks ----
export async function tokenActivity(rawAddress, blocks = 2000) {
  if (!isAddress(rawAddress)) return { error: "invalid_address", input: rawAddress };
  const address = getAddress(rawAddress);
  const dec = await client.readContract({ address, abi: ERC20, functionName: "decimals" }).catch(() => null);
  if (dec == null) return { error: "not_erc20_compatible", address };
  const head = await client.getBlockNumber();
  const span = BigInt(Math.min(blocks, 5000));
  const from = head - span;
  const logs = await client.getLogs({
    address,
    event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
    fromBlock: from, toBlock: head
  }).catch(() => []);
  let volume = 0n; const senders = new Set(), receivers = new Set();
  for (const l of logs) {
    volume += l.args.value ?? 0n;
    if (l.args.from) senders.add(l.args.from.toLowerCase());
    if (l.args.to) receivers.add(l.args.to.toLowerCase());
  }
  return {
    chain: "base", address,
    window_blocks: Number(span),
    approx_window_minutes: Number(span) * 2 / 60,
    transfer_count: logs.length,
    transfer_volume: formatUnits(volume, Number(dec)),
    unique_senders: senders.size,
    unique_receivers: receivers.size,
    activity_level: logs.length === 0 ? "dormant" : logs.length < 20 ? "low" : logs.length < 200 ? "moderate" : "high",
    checked_at: new Date().toISOString()
  };
}

// ---- ENS / Basename-style reverse: resolve address label if set (read-only best-effort) ----
export async function blockInfo() {
  const [block, gasPrice] = await Promise.all([client.getBlock(), client.getGasPrice().catch(() => null)]);
  return {
    chain: "base",
    number: Number(block.number),
    timestamp: Number(block.timestamp),
    time_iso: new Date(Number(block.timestamp) * 1000).toISOString(),
    tx_count: block.transactions.length,
    gas_used: block.gasUsed?.toString() ?? null,
    gas_limit: block.gasLimit?.toString() ?? null,
    utilization_pct: block.gasLimit ? Number((block.gasUsed * 10000n) / block.gasLimit) / 100 : null,
    gas_price_gwei: gasPrice ? Number(formatUnits(gasPrice, 9)) : null,
    checked_at: new Date().toISOString()
  };
}

// ---- Address portfolio: ETH + balances of canonical tokens in one call ----
const CANON = {
  USDC:{a:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",d:6},
  WETH:{a:"0x4200000000000000000000000000000000000006",d:18},
  CBBTC:{a:"0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",d:8},
  EURC:{a:"0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",d:6}
};
export async function portfolio(rawAddress) {
  if (!isAddress(rawAddress)) return { error: "invalid_address", input: rawAddress };
  const address = getAddress(rawAddress);
  const [eth, ...bals] = await Promise.all([
    client.getBalance({ address }),
    ...Object.values(CANON).map(t =>
      client.readContract({ address: t.a, abi: ERC20, functionName: "balanceOf", args: [address] }).catch(() => 0n))
  ]);
  const tokens = {};
  Object.entries(CANON).forEach(([sym, t], i) => { tokens[sym] = formatUnits(bals[i], t.d); });
  return {
    chain: "base", address,
    eth_balance: formatEther(eth),
    token_balances: tokens,
    note: "Balances only for canonical Base tokens (USDC, WETH, cbBTC, EURC). Amounts are raw token units, not USD.",
    checked_at: new Date().toISOString()
  };
}
