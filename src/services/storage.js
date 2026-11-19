// src/services/storage.js
const { createClient } = require('@supabase/supabase-js');

let _client = null;
function normalizeUrl(raw) {
  if (!raw) return raw;
  // Strip trailing /rest/v1 or /rest/v1/ and any trailing slash
  return raw.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}
function getClient() {
  if (!_client) {
    const url = normalizeUrl(process.env.SUPABASE_URL);
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    _client = createClient(url, key);
  }
  return _client;
}

/**
 * Upload a file buffer to a private Supabase bucket.
 * Returns { storagePath } on success, throws on failure.
 */
async function uploadFile(bucket, path, buffer, mimeType) {
  const client = getClient();
  if (!client) throw new Error('Supabase not configured');
  const { error } = await client.storage.from(bucket).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw error;
  return { storagePath: path };
}

/**
 * Generate a signed URL (private bucket) valid for `expiresIn` seconds (default 300).
 */
async function getSignedUrl(bucket, path, expiresIn = 300) {
  const client = getClient();
  if (!client) throw new Error('Supabase not configured');
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

module.exports = { uploadFile, getSignedUrl };
