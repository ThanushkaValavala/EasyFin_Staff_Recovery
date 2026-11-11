import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

// Log the API URL once at module load so it's visible in the dev console
console.log('[API] Base URL:', API_URL);

async function request(method, path, body) {
  const token = await SecureStore.getItemAsync('token');

  // 10-second timeout so a sleeping Render instance doesn't hang the UI
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'AbortError') {
      const e = new Error('Network request failed');
      e.isNetworkError = true;
      throw e;
    }
    // Propagate as-is (covers "Network request failed" from RN)
    fetchErr.isNetworkError = true;
    throw fetchErr;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 5xx from a sleeping/broken backend â†’ treat as network error
    if (res.status >= 500) {
      const e = new Error('Network request failed');
      e.isNetworkError = true;
      e.status = res.status;
      throw e;
    }
    const err = new Error(data.message || 'Something went wrong');
    err.data = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

export const apiGet = (path) => request('GET', path);
export const apiPost = (path, body) => request('POST', path, body);
export const apiPatch = (path, body) => request('PATCH', path, body);

export async function apiUpload(path, fields, fileUri) {
  const token = await SecureStore.getItemAsync('token');
  const form = new FormData();
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) form.append(k, String(v));
  });
  form.append('photo', new File(fileUri));
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Upload failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function apiUploadFile(path, fields, fieldName, fileUri) {
  const token = await SecureStore.getItemAsync('token');
  const form = new FormData();
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  form.append(fieldName, new File(fileUri));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'Upload failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Network request failed');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiUploadFiles(path, fields, filesMap) {
  const token = await SecureStore.getItemAsync('token');
  const form = new FormData();
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  Object.entries(filesMap || {}).forEach(([fieldName, fileUri]) => {
    if (fileUri) {
      form.append(fieldName, new File(fileUri));
    }
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'Upload failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Network request failed');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function warmUpServer() {
  const base = API_URL.replace(/\/api\/v1\/?$/, '');
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const r = await fetch(`${base}/api/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return true;
    } catch (e) {}
  }
  return false;
}
