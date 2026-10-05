import { readFileSync } from "node:fs";

import { MemWal } from "@mysten-incubation/memwal";

const input = JSON.parse(readFileSync(0, "utf8"));
const memwal = MemWal.create({
  key: input.key,
  accountId: input.accountId,
  serverUrl: input.serverUrl,
  namespace: input.namespace,
});
if (input.action === "verify") {
  const compatibility = await memwal.compatibility();
  const recalled = await memwal.recall({
    query: "hub connection check",
    limit: 1,
    namespace: input.namespace,
  });
  process.stdout.write(
    JSON.stringify({
      status: "verified",
      memories: [],
      detail: `Delegate verified. Public key ${await memwal.getPublicKeyHex()}. This does not prove owner-wallet possession.`,
    }),
  );
} else if (input.action === "remember") {
  const saved = await memwal.rememberAndWait(input.text, undefined, { timeoutMs: 20000 });
  process.stdout.write(JSON.stringify({
    status: "saved",
    memories: [],
    detail: `Memory accepted the fact. Job status ${saved?.status ?? "unknown"}. Search visibility can lag storage completion. This is not a Console upload.`,
  }));
} else {
  const result = await memwal.recall({
    query: input.query,
    limit: 5,
    namespace: input.namespace,
  });
  process.stdout.write(
    JSON.stringify({
      status: "recalled",
      memories: result.results.map((memory) => ({
        text: memory.text,
        blobId: memory.blob_id,
      })),
    }),
  );
}
