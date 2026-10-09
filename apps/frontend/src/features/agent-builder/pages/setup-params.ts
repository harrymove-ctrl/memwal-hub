/** Which setup dialog a URL is asking to open. `connect` wins over the older `setup` alias. */
export type SetupTarget = "model" | "memory";


export function setupTarget(params: URLSearchParams): SetupTarget | null {
  const connect = params.get("connect");
  if (connect === "model" || connect === "memory") return connect;
  const setup = params.get("setup");
  if (setup === "model" || setup === "memory") return setup;
  return null;
}

/** Drops only the query values that opened `closed`. Other params stay. */
export function paramsAfterClose(params: URLSearchParams, closed: SetupTarget): URLSearchParams {
  const next = new URLSearchParams(params);
  if (next.get("connect") === closed) next.delete("connect");
  if (next.get("setup") === closed) next.delete("setup");
  return next;
}

export function canonicalSetupPath(target: SetupTarget): string {
  return `/builder/integrations?connect=${target}`;
}
