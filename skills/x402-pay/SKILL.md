---
name: x402-pay
description: Install an Open Wallet Standard (OWS) wallet, create a local wallet and record its addresses in CLAUDE.md, and make paid (x402) API requests signed by that wallet in USDC. Triggers - "install the OWS wallet", "set up x402", "create a wallet", "make an x402 payment", "order coffee", "buy premium beans", "pay for <url>".
tags: [payments, api, wallet, setup]
---

# x402-pay

This skill covers three actions. Pick the one that matches the request:

1. **[Install OWS](#action-1-install-ows)** — install the OWS CLI and the components this skill needs.
2. **[Create a wallet + record addresses](#action-2-create-a-wallet-and-record-addresses)** — make a local wallet and write its addresses into `CLAUDE.md`.
3. **[Make an x402 payment](#action-3-make-an-x402-payment)** — call an x402-protected URL and pay for it.

Payments are signed by a local **Open Wallet Standard (OWS)** wallet. The private
key stays encrypted in the OWS vault (`~/.ows/wallets/`) and is never written to
the repo, `.env`, or exposed to the script.

---

## Action 1: Install OWS

OWS ships a Rust core with native bindings — **no Rust toolchain required** (the
npm packages bundle prebuilt binaries for macOS arm64/x64 and Linux x64/arm64).
Node.js ≥ 18 must already be installed.

**a) Install the global `ows` CLI** (provides `ows wallet`, `ows fund`, etc.):

```bash
npm install -g @open-wallet-standard/core
ows --version
```

> Alternative full installer (CLI + Node + Python bindings):
> `curl -fsSL https://docs.openwallet.sh/install.sh | bash`

**b) Install the skill's script dependencies** (the SDK, the viem adapter, and the
x402 client used by `pay.ts`):

```bash
cd .claude/skills/x402-pay/scripts
npm install
```

This installs, per `scripts/package.json`:

| Package | Role |
|---------|------|
| `@open-wallet-standard/core` | OWS vault + signing (native binding) |
| `@open-wallet-standard/adapters` | `owsToViemAccount` — wraps the vault as a viem signer |
| `viem` | EVM account interface used by the x402 client |
| `x402-fetch` | x402 **V1** payment client |
| `dotenv` | loads `.env` |
| `tsx`, `typescript`, `@types/node` | run/type the script |

The global CLI (a) is optional if you create wallets via the SDK (see Action 2),
but it's the easiest way to run `ows wallet list` / `ows fund balance`.

---

## Action 2: Create a wallet and record addresses

**1. Create the wallet.** Either the CLI or the SDK works; both write to the same
vault (`~/.ows/wallets/`) and derive addresses for every supported chain.

```bash
# CLI (preferred)
ows wallet create --name headless-vibe
ows wallet list
```

```bash
# SDK fallback (no global CLI). Run from .claude/skills/x402-pay/scripts:
node -e '
const ows = require("@open-wallet-standard/core");
const name = "headless-vibe";
let w = ows.listWallets().find(x => x.name === name) || (ows.createWallet(name), ows.getWallet(name));
const evm = w.accounts.find(a => a.chainId.startsWith("eip155:"));
console.log("EVM address:", evm.address);
'
```

**2. Record the wallet in `CLAUDE.md`.** Add (or update) a `## Crypto wallet`
section so the address is shared with anyone who clones the project. Include:

- **Wallet name** (e.g. `headless-vibe`)
- **EVM address** — the `eip155:*` account; identical across all EVM chains incl. Base Sepolia
- **Payment network** — Base Sepolia testnet (chain ID **84532**)
- **USDC on Base Sepolia** — `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

Example block to write into `CLAUDE.md`:

```markdown
## Crypto wallet
- Wallet name: **headless-vibe** (OWS, keys in ~/.ows/wallets/)
- EVM address (all EVM chains, incl. Base Sepolia): 0x83425FD2cC0EFECee4b6D5a85A90F7944e2A981c
- Payment network: Base Sepolia testnet (chain ID 84532)
- USDC on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

**3. Point the skill at the wallet.** Create `.claude/skills/x402-pay/scripts/.env`
(covered by the repo's `.env*` gitignore — no secret is stored, just the name):

```
OWS_WALLET=headless-vibe
EVM_RPC_URL=https://sepolia.base.org
# X402_CHAIN=eip155:84532   # optional; Base Sepolia is the default
```

**4. Fund it.** Send **Base Sepolia USDC** to the EVM address from the Circle
faucet (https://faucet.circle.com → Base Sepolia). **No native ETH needed** — the
x402 facilitator pays the gas. Check the balance with
`ows fund balance --wallet headless-vibe` (or query the chain RPC directly;
MoonPay-style balance APIs do not index testnets).

---

## Action 3: Make an x402 payment

Call an x402-protected endpoint; the script handles the `402 → sign → retry` flow
and pays from the OWS wallet.

The script defaults to **POST** and always sends `Accept: application/json` (many
x402 servers only emit the `402` challenge for JSON POSTs). It speaks x402 **V1**
via `x402-fetch`.

```bash
cd .claude/skills/x402-pay/scripts

# Pay for premium beans (the workshop demo endpoint)
npx tsx pay.ts --url https://cafe-chooser-pro.lovable.app/api/public/premium-beans --body '{}'

# Custom POST body
npx tsx pay.ts --url <endpoint> --body '{"size":"large"}'

# A GET-style x402 endpoint
npx tsx pay.ts --url <endpoint> --method GET

# Query params
npx tsx pay.ts --url <endpoint> --params '{"roast":"dark"}'
```

On success it prints the HTTP status, the JSON response, and the settlement
(`transaction`, `network`, `payer`). Verify at
`https://sepolia.basescan.org/tx/<hash>`.

If a request needs a name and none is given, default to **Andy** (see CLAUDE.md).

### How the payment works

1. The script POSTs the request; the server replies `402 Payment Required` with
   the accepted networks/amounts.
2. The OWS viem adapter (`owsToViemAccount`) produces a viem account that signs
   the **EIP-3009 `transferWithAuthorization`** payload inside the vault.
3. The request is retried with the signed `X-PAYMENT` header.
4. The server's facilitator settles the transfer on-chain and **pays the gas** —
   the wallet only needs USDC, not ETH.

> Implementation note: the OWS viem adapter leaves viem's `sign` undefined and
> omits the `EIP712Domain` type (viem derives it internally). `pay.ts` shims both
> — it supplies a `sign` backed by OWS `signHash` and reconstructs `EIP712Domain`
> from the domain fields — so the OWS core accepts the strict
> `eth_signTypedData_v4` payload x402 produces.

### Notes

- Requires the OWS wallet to hold USDC on the target network.
- If the request fails (status ≥ 400) the payment is not settled — you don't pay
  for errors.
- The **x402.org facilitator** is configured on the *server* side (for our own
  paid API later in the workshop), not here — this skill is the *paying client*.

## Related

- `moonpay-check-wallet` — check balances (note: that API does not index testnets).
- OWS SDK/CLI docs: https://github.com/open-wallet-standard/core
