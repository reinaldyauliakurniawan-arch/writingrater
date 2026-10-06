// Helper fetch untuk browser: { data } -> data, { error } -> lempar ApiClientError dengan pesan Indonesia.
export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiClientError("NETWORK", "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || "error" in body) {
    throw new ApiClientError(
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? "Terjadi kesalahan. Coba lagi.",
    );
  }
  return body.data as T;
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiClientError ? e.message : "Terjadi kesalahan. Coba lagi.";
