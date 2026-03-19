const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export type ApiError = { message: string };

function getToken(): string | null {
  return localStorage.getItem("accessToken");
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  const token = getToken();
  if (token)
    headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data?.message === "string" ? data.message : "请求失败";
    throw new Error(msg);
  }
  return data as T;
}
