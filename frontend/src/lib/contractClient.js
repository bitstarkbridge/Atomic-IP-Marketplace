import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org";

const ATOMIC_SWAP_CONTRACT_ID = import.meta.env.VITE_CONTRACT_ATOMIC_SWAP;

/**
 * Calls cancel_swap(swap_id) on the atomic_swap contract.
 * @param {string} swapId - The swap ID (u64 as string or number)
 * @param {object} wallet  - Connected wallet with signTransaction method
 * @returns {Promise<void>}
 */
export async function cancelSwap(swapId, wallet) {
  if (!ATOMIC_SWAP_CONTRACT_ID) {
    throw new Error("VITE_CONTRACT_ATOMIC_SWAP is not configured.");
  }

  const server = new StellarSdk.SorobanRpc.Server(RPC_URL);
  const sourceAccount = await server.getAccount(wallet.address);

  const contract = new StellarSdk.Contract(ATOMIC_SWAP_CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      import.meta.env.VITE_STELLAR_NETWORK === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "cancel_swap",
        StellarSdk.nativeToScVal(Number(swapId), { type: "u64" })
      )
    )
    .setTimeout(30)
    .build();

  await submitAndPoll(tx, wallet, server);
}

/**
 * Shared helper: build, sign, submit and poll a Soroban transaction.
 * @param {StellarSdk.Transaction} tx
 * @param {object} wallet
 * @param {StellarSdk.SorobanRpc.Server} server
 */
async function submitAndPoll(tx, wallet, server) {
  const preparedTx = await server.prepareTransaction(tx);
  const networkPassphrase =
    import.meta.env.VITE_STELLAR_NETWORK === "mainnet"
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;

  const signedXdr = await wallet.signTransaction(preparedTx.toXDR());
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  const result = await server.sendTransaction(signedTx);
  if (result.status === "ERROR") {
    throw new Error(`Transaction failed: ${result.errorResult}`);
  }

  let response = result;
  while (response.status === "PENDING" || response.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1500));
    response = await server.getTransaction(result.hash);
  }

  if (response.status !== "SUCCESS") {
    throw new Error(`Transaction did not succeed: ${response.status}`);
  }
}

/**
 * Calls confirm_swap(swap_id, decryption_key) on the atomic_swap contract.
 * @param {string|number} swapId
 * @param {string} decryptionKey - hex or base64 string of the decryption key
 * @param {object} wallet        - { address, signTransaction }
 */
export async function confirmSwap(swapId, decryptionKey, wallet) {
  if (!ATOMIC_SWAP_CONTRACT_ID) {
    throw new Error("VITE_CONTRACT_ATOMIC_SWAP is not configured.");
  }
  if (!decryptionKey || !decryptionKey.trim()) {
    throw new Error("Decryption key is required.");
  }

  const networkPassphrase =
    import.meta.env.VITE_STELLAR_NETWORK === "mainnet"
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;

  const server = new StellarSdk.SorobanRpc.Server(RPC_URL);
  const sourceAccount = await server.getAccount(wallet.address);
  const contract = new StellarSdk.Contract(ATOMIC_SWAP_CONTRACT_ID);

  // Encode decryption key as Soroban Bytes (hex string → Buffer → ScVal)
  const keyBytes = StellarSdk.xdr.ScVal.scvBytes(
    Buffer.from(decryptionKey.replace(/^0x/, ""), "hex")
  );

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "confirm_swap",
        StellarSdk.nativeToScVal(Number(swapId), { type: "u64" }),
        keyBytes
      )
    )
    .setTimeout(30)
    .build();

  await submitAndPoll(tx, wallet, server);
}
