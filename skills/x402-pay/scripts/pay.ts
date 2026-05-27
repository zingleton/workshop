/**
 * x402-pay — make a paid (x402) HTTP request, signed by an Open Wallet Standard (OWS) wallet.
 *
 * The private key never leaves the OWS vault (~/.ows/wallets/). The OWS viem
 * adapter returns a viem `LocalAccount` whose signing is delegated to the vault,
 * and the x402 client uses it to sign the EIP-3009 `transferWithAuthorization`
 * payload. The resource server's facilitator settles on-chain and pays the gas,
 * so this wallet only needs USDC — no native ETH.
 *
 * Uses the x402 **V1** client (`x402-fetch`), which speaks the `x402Version: 1`
 * protocol with string network names like `base-sepolia`.
 *
 * Usage:
 *   npx tsx pay.ts --url <endpoint> [--method POST] [--body '<json>'] [--params '<json>'] [--chain eip155:84532]
 *
 * Env (.env in this dir):
 *   OWS_WALLET    name or id of the OWS wallet to pay from        (required)
 *   X402_CHAIN    CAIP-2 chain hint for picking the EVM account   (optional, default eip155:84532)
 */
import "dotenv/config";
import { owsToViemAccount } from "@open-wallet-standard/adapters/viem";
import { signHash } from "@open-wallet-standard/core";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

type Args = {
  url?: string;
  method: string;
  body?: string;
  params?: string;
  chain: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    method: "POST",
    chain: process.env.X402_CHAIN ?? "eip155:84532",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--url":
        out.url = next();
        break;
      case "--method":
        out.method = (next() ?? "POST").toUpperCase();
        break;
      case "--body":
        out.body = next();
        break;
      case "--params":
        out.params = next();
        break;
      case "--chain":
        out.chain = next() ?? out.chain;
        break;
      default:
        if (!a.startsWith("--") && !out.url) out.url = a; // allow bare URL
    }
  }
  return out;
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) fail("Missing --url <x402-protected endpoint>.");

  const walletName = process.env.OWS_WALLET;
  if (!walletName) fail("Missing OWS_WALLET env var (the OWS wallet name to pay from).");

  // Build the URL, applying optional query params.
  let url = args.url!;
  if (args.params) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(args.params);
    } catch {
      fail("--params must be a JSON object of query parameters.");
    }
    const u = new URL(url);
    for (const [k, v] of Object.entries(parsed!)) u.searchParams.set(k, String(v));
    url = u.toString();
  }

  // OWS-backed viem LocalAccount — signs via the encrypted vault, never exposes the key.
  // The adapter leaves `sign` undefined; x402's signer type guard requires a `sign`
  // function (even though the exact-EVM EIP-3009 flow only calls `signTypedData`),
  // so we supply one backed by the OWS `signHash` primitive.
  const base = owsToViemAccount(walletName, { chain: args.chain });
  const account = {
    ...base,
    sign: async ({ hash }: { hash: `0x${string}` }) => {
      const r = signHash(walletName, args.chain, hash);
      let sig = r.signature.startsWith("0x") ? r.signature.slice(2) : r.signature;
      if (sig.length === 128 && r.recoveryId != null) {
        sig += (27 + r.recoveryId).toString(16).padStart(2, "0"); // append v
      }
      return ("0x" + sig) as `0x${string}`;
    },
    // viem omits the EIP712Domain type from `types` (it derives it internally), but
    // the OWS core expects strict eth_signTypedData_v4 JSON that *defines* the
    // EIP712Domain type. Reconstruct it from the domain fields actually present.
    signTypedData: async (typedData: any) => {
      if (typedData?.domain && !typedData?.types?.EIP712Domain) {
        const fieldType: Record<string, string> = {
          name: "string",
          version: "string",
          chainId: "uint256",
          verifyingContract: "address",
          salt: "bytes32",
        };
        const EIP712Domain = ["name", "version", "chainId", "verifyingContract", "salt"]
          .filter((k) => typedData.domain[k] !== undefined)
          .map((k) => ({ name: k, type: fieldType[k] }));
        typedData = { ...typedData, types: { EIP712Domain, ...typedData.types } };
      }
      return base.signTypedData(typedData);
    },
  };
  console.log(`Wallet:  ${walletName}  (${account.address})`);
  console.log(`Request: ${args.method} ${url}\n`);

  // V1 x402 client. Default maxValue is 0.10 USDC; this endpoint charges 0.01.
  const fetchWithPayment = wrapFetchWithPayment(fetch, account as Parameters<typeof wrapFetchWithPayment>[1]);

  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method: args.method, headers };
  if (args.body && !["GET", "HEAD"].includes(args.method)) {
    init.body = args.body;
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithPayment(url, init);

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  console.log(`Status:  ${response.status} ${response.statusText}`);
  console.log("Body:", typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));

  // Settlement details (tx hash, network, payer) so the payment can be verified on a block explorer.
  const settleHeader = response.headers.get("x-payment-response");
  if (settleHeader) {
    const settle = decodeXPaymentResponse(settleHeader);
    console.log("\nPayment settled:", JSON.stringify(settle, null, 2));
  } else {
    console.log("\n(No X-PAYMENT-RESPONSE header — endpoint did not require/confirm payment.)");
  }

  if (!response.ok) process.exit(1);
}

main().catch((err) => {
  fail(err?.response?.data?.error ?? err?.message ?? String(err));
});
