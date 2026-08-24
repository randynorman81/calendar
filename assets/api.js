const API_URL = "/api/data";

async function apiGet(action, params) {
  const qs = new URLSearchParams(Object.assign({ action }, params || {}));
  const res = await fetch(`${API_URL}?${qs.toString()}`);
  if (!res.ok) throw new Error("Network error");
  return res.json();
}

async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Network error");
  return res.json();
}
