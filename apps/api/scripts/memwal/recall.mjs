// Walrus Memory bridge for the Rust API.
//
// The API passes one JSON request on stdin (the delegate key never appears on a
// command line or in an environment variable) and reads one JSON reply from
// stdout. Every reply is either `{ "ok": true, ... }` or
// `{ "ok": false, "code": "...", "message": "..." }`. Messages never contain
// the delegate key.
import { readFileSync } from "node:fs";

import { MemWal, MemWalCompatibilityError } from "@mysten-incubation/memwal";


const input = JSON.parse(readFileSync(0, "utf8"));
const secret = typeof input.key === "string" ? input.key : "";

function reply(body) {
  process.stdout.write(JSON.stringify(body));
}

function redact(text) {
  let value = String(text ?? "");
  if (secret) value = value.split(secret).join("[redacted]");
  return value.replace(/suiprivkey1[0-9a-z]+/gi, "[redacted]").slice(0, 400);
}

function classify(error) {
  if (error instanceof MemWalCompatibilityError || error?.name === "MemWalCompatibilityError") {
    return { code: "unsupported_version", message: "The Walrus Memory relayer API version is not supported by this SDK version." };
  }
  const status = Number(error?.status);
  const text = String(error?.message ?? "");
  if (status === 401 || status === 403 || error?.serverCode === "AUTH_REJECTED") {
    return { code: "invalid_credentials", message: "The relayer rejected the delegate key for this account. Check that the key is registered on this Mainnet account." };
  }
  if (status === 404) return { code: "account_not_found", message: "The relayer could not find this account." };
  if (status === 429) return { code: "relayer_rate_limited", message: "The Walrus Memory relayer is rate limiting requests. Try again shortly." };
  if (status >= 500 || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|timed out|timeout|aborted|socket/i.test(text)) {
    return { code: "relayer_unavailable", message: "The Walrus Memory relayer is unavailable or did not answer in time." };
  }
  if (/invalid.*(key|hex)|private key|bech32|expected 32 bytes/i.test(text)) {
    return { code: "invalid_credentials", message: "The delegate key is not a valid Ed25519 private key." };
  }
  return { code: "relayer_error", message: redact(text) || "The Walrus Memory request failed." };
}

async function relayerConfig(serverUrl) {
  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/config`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Object.assign(new Error(`GET /config returned ${response.status}`), { status: response.status });
  const body = await response.json();
  return {
    network: typeof body.network === "string" ? body.network : "unknown",
    packageId: typeof body.packageId === "string" ? body.packageId : null,
    // The relayer publishes the JSON-RPC endpoint it trusts for its own network.
    suiRpcUrl: process.env.MEMWAL_SUI_RPC_URL || (typeof body.suiRpcUrl === "string" ? body.suiRpcUrl : null),
  };
}

async function accountObject(rpcUrl, accountId) {
  if (!rpcUrl) throw Object.assign(new Error("The relayer did not publish a Sui RPC URL."), { status: 503 });
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getObject", params: [accountId, { showType: true, showOwner: true, showContent: true }] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Object.assign(new Error(`Sui RPC returned ${response.status}`), { status: 503 });
  const body = await response.json();
  if (!body.result?.data) return null;
  const data = body.result.data;
  const fields = data.content?.fields ?? {};
  return {
    type: data.type ?? null,
    owner: typeof fields.owner === "string" ? fields.owner : null,
    active: fields.active !== false,
    quarantined: fields.admin_quarantined === true,
  };
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Object.assign(new Error(`Sui RPC returned ${response.status}`), { status: 503 });
  const body = await response.json();
  if (body.error) throw Object.assign(new Error(`Sui RPC ${method} failed: ${body.error.message ?? "error"}`), { status: 503 });
  return body.result;
}

const normalizeHex = (value) => String(value ?? "").toLowerCase().replace(/^0x/, "");

/**
 * Counts Walrus Blob objects owned by the account owner on Sui Mainnet and
 * reads the memwal_* metadata the relayer stamps on each one
 * (memwal_namespace, memwal_package_id, memwal_agent_id = delegate public key).
 * This is chain data, not the relayer's own index.
 */
async function onChainBlobs(rpcUrl, owner, packageId, agentPublicKey) {
  const blobs = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const result = await rpc(rpcUrl, "suix_getOwnedObjects", [owner, { options: { showType: true } }, cursor, 50]);
    for (const item of result?.data ?? []) {
      if (/::blob::Blob$/.test(item.data?.type ?? "")) blobs.push(item.data.objectId);
    }
    if (!result?.hasNextPage) break;
    cursor = result.nextCursor;
  }
  const metadataName = { type: "vector<u8>", value: [...Buffer.from("metadata")] };
  // Every owned blob is checked (a few concurrent reads at a time, well within
  // public RPC limits); none is skipped, so the count is complete.
  const rows = new Array(blobs.length);
  let next = 0;
  async function worker() {
    while (next < blobs.length) {
      const index = next;
      next += 1;
      const metadata = {};
      try {
        const field = await rpc(rpcUrl, "suix_getDynamicFieldObject", [blobs[index], metadataName]);
        const contents = field?.data?.content?.fields?.value?.fields?.metadata?.fields?.contents ?? [];
        for (const entry of contents) {
          const pair = entry?.fields ?? entry;
          if (typeof pair?.key === "string") metadata[pair.key] = pair.value;
        }
      } catch {
        // A blob whose metadata cannot be read is not counted for this agent.
      }
      rows[index] = {
        namespace: metadata.memwal_namespace ?? null,
        packageId: metadata.memwal_package_id ?? null,
        agentId: metadata.memwal_agent_id ?? null,
      };
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const memwal = rows.filter((row) => row.packageId && packageId && normalizeHex(row.packageId) === normalizeHex(packageId));
  const mine = memwal.filter((row) => row.agentId && normalizeHex(row.agentId) === normalizeHex(agentPublicKey));
  const byNamespace = {};
  for (const row of mine) byNamespace[row.namespace ?? "(none)"] = (byNamespace[row.namespace ?? "(none)"] ?? 0) + 1;
  return {
    walrusBlobObjectsOwned: blobs.length,
    metadataChecked: rows.filter(Boolean).length,
    memwalBlobsForThisPackage: memwal.length,
    memwalBlobsForThisAgent: mine.length,
    memwalBlobsForThisAgentByNamespace: byNamespace,
  };
}

function client() {
  return MemWal.create({
    key: secret,
    accountId: input.accountId,
    serverUrl: input.serverUrl,
    namespace: input.namespace,
  });
}

async function main() {
  switch (input.action) {
    case "verify": {
      const config = await relayerConfig(input.serverUrl);
      const network = config.network;
      if (network !== "mainnet") {
        return reply({ ok: false, code: "wrong_network", message: `The relayer reports network "${network}". This workspace requires Mainnet.` });
      }
      const account = await accountObject(config.suiRpcUrl, input.accountId);
      if (!account) {
        return reply({ ok: false, code: "account_not_found", message: "No object with this account ID exists on Sui Mainnet." });
      }
      const expectedType = config.packageId ? `${config.packageId}::account::MemWalAccount` : null;
      if (!account.type || !/::account::MemWalAccount$/.test(account.type) || (expectedType && account.type !== expectedType)) {
        return reply({ ok: false, code: "account_not_found", message: "The object at this ID is not a Walrus Memory account for this Mainnet relayer." });
      }
      if (!account.active || account.quarantined) {
        return reply({ ok: false, code: "invalid_credentials", message: "This Walrus Memory account is inactive or quarantined." });
      }
      const memwal = client();
      const compatibility = await memwal.compatibility();
      // A real signed operation: the relayer resolves the delegate against the
      // on-chain account before it lists namespaces.
      const page = await memwal.listNamespaces({ limit: 100 });
      return reply({
        ok: true,
        network,
        apiVersion: compatibility.apiVersion,
        relayerVersion: compatibility.relayerVersion,
        ownerAddress: account.owner,
        publicKey: await memwal.getPublicKeyHex(),
        namespaces: page.namespaces.map((item) => ({ name: item.name, memoryCount: item.memory_count })),
      });
    }
    case "recall": {
      const result = await client().recall({ query: input.query, limit: input.limit ?? 8, namespace: input.namespace });
      return reply({
        ok: true,
        droppedCount: result.dropped_count ?? 0,
        memories: result.results.map((memory) => ({
          text: memory.text,
          blobId: memory.blob_id ?? null,
          distance: typeof memory.distance === "number" ? memory.distance : null,
          createdAt: memory.created_at ?? null,
        })),
      });
    }
    case "remember_submit": {
      const accepted = await client().rememberAsync(input.text, input.namespace, { idempotencyKey: input.idempotencyKey });
      return reply({ ok: true, jobId: accepted.job_id, status: accepted.status });
    }
    case "remember_status": {
      const memwal = client();
      const jobs = [];
      for (const jobId of input.jobIds ?? []) {
        try {
          const status = await memwal.getRememberStatus(jobId);
          jobs.push({ jobId, status: status.status, blobId: status.blob_id ?? null, error: status.error ? redact(status.error) : null });
        } catch (error) {
          const classified = classify(error);
          jobs.push({ jobId, status: "unknown", blobId: null, error: classified.message, code: classified.code });
        }
      }
      return reply({ ok: true, jobs });
    }
    case "stats": {
      const memwal = client();
      const config = await relayerConfig(input.serverUrl);
      const account = await accountObject(config.suiRpcUrl, input.accountId);
      const namespaces = [];
      let cursor;
      for (let page = 0; page < 20; page += 1) {
        const result = await memwal.listNamespaces({ cursor, limit: 100 });
        namespaces.push(...result.namespaces.map((item) => ({ name: item.name, memoryCount: item.memory_count, updatedAt: item.updated_at })));
        if (!result.has_more) break;
        cursor = result.next_cursor ?? undefined;
      }
      const publicKey = await memwal.getPublicKeyHex();
      let onChain = null;
      let onChainError = null;
      if (account?.owner && config.suiRpcUrl) {
        try {
          onChain = await onChainBlobs(config.suiRpcUrl, account.owner, config.packageId, publicKey);
        } catch (error) {
          onChainError = redact(error?.message);
        }
      }
      return reply({
        ok: true,
        network: config.network,
        packageId: config.packageId,
        ownerAddress: account?.owner ?? null,
        agentPublicKey: publicKey,
        namespaces,
        onChain,
        onChainError,
      });
    }
    default:
      return reply({ ok: false, code: "unsupported_action", message: "Unsupported Walrus Memory action." });
  }
}

main().catch((error) => {
  reply({ ok: false, ...classify(error) });
});
