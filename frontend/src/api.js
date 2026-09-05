const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => {
  refreshSubscribers.push(cb);
};

const onRefreshed = (token) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

export const api = async (path, options = {}, token = null, extraHeaders = {}) => {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res = await fetch(`${BASE}${path}`, { ...options, headers });

  // Handling 204 No Content or empty response body just in case
  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { msg: text };
  }

  // Handle 401 Unauthorized by trying to refresh the token
  if (res.status === 401 && token) {
    const refreshToken = localStorage.getItem("refreshToken");
    if (refreshToken) {
      // FIX: If another request is already refreshing, subscribe and wait.
      // Only the first 401 initiates the refresh; all others queue up.
      if (isRefreshing) {
        // Wait for the in-progress refresh to finish
        const newToken = await new Promise((resolve) => {
          subscribeTokenRefresh((t) => resolve(t));
        });

        if (newToken) {
          headers["Authorization"] = `Bearer ${newToken}`;
          res = await fetch(`${BASE}${path}`, { ...options, headers });
          const retryText = await res.text();
          try {
            data = retryText ? JSON.parse(retryText) : {};
          } catch {
            data = { msg: retryText };
          }
        } else {
          throw new Error("Session expired, please login again");
        }
      } else {
        // This is the first 401 — initiate the refresh
        isRefreshing = true;
        try {
          const refreshRes = await fetch(`${BASE}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken })
          });

          const refreshText = await refreshRes.text();
          let refreshData;
          try {
            refreshData = refreshText ? JSON.parse(refreshText) : {};
          } catch {
            refreshData = {};
          }

          if (!refreshRes.ok) {
            throw new Error("Session expired, please login again");
          }

          const newAccessToken = refreshData.accessToken;
          localStorage.setItem("token", newAccessToken);

          if (window.__onTokenRefresh) {
            window.__onTokenRefresh(newAccessToken);
          }

          isRefreshing = false;
          onRefreshed(newAccessToken);

          // FIX: Retry the CURRENT request with the new token
          // (Previously this fell through without retrying for the initiating request)
          headers["Authorization"] = `Bearer ${newAccessToken}`;
          res = await fetch(`${BASE}${path}`, { ...options, headers });
          const retryText = await res.text();
          try {
            data = retryText ? JSON.parse(retryText) : {};
          } catch {
            data = { msg: retryText };
          }
        } catch {
          isRefreshing = false;
          onRefreshed(null);

          // Clear everything and logout
          localStorage.removeItem("token");
          localStorage.removeItem("refreshToken");
          localStorage.removeItem("user");
          if (window.__onTokenRefresh) {
            window.__onTokenRefresh(null);
          }
          throw new Error("Session expired, please login again");
        }
      }
    }
  }

  if (!res.ok) throw new Error(data.msg || data.message || "Something went wrong");
  return data;
};

export const checkMaintenance = async () => {
  try {
    const res = await fetch(BASE);
    const data = await res.json();
    return data.maintenance === true;
  } catch {
    return false;
  }
};
