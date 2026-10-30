export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfter?: number) { super(message); }
}
export async function api<T>(path: string, token?: string, method = "GET", data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/rooms${path}`, {
      method, cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  } catch { throw new ApiError("Connection lost. Your unsaved text is still here.", 0); }
  const result = await response.json().catch(() => ({ error: "Something went wrong. Please try again." }));
  if (!response.ok) throw new ApiError(result.error, response.status, result.code, Number(response.headers.get("retry-after")) || undefined);
  return result as T;
}
