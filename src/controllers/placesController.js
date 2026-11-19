// src/controllers/placesController.js
const https = require('https');

// Per-agent rate limiting: 3 requests per second
const agentRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_REQUESTS_PER_WINDOW = 3;

// In-memory query cache: 60 seconds TTL, cap 500 entries
const queryCache = new Map();
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function isRateLimited(agentKey) {
  const key = agentKey || 'anonymous';
  const now = Date.now();
  let timestamps = agentRequests.get(key);
  if (!timestamps) {
    timestamps = [];
    agentRequests.set(key, timestamps);
  }
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    agentRequests.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  agentRequests.set(key, timestamps);

  // Periodic cleanup if map gets large
  if (agentRequests.size > 1000) {
    for (const [k, times] of agentRequests.entries()) {
      if (!times.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) {
        agentRequests.delete(k);
      }
    }
  }

  return false;
}

function getCached(key) {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    queryCache.delete(key);
    return null;
  }
  return entry.results;
}

function setCached(key, results) {
  const now = Date.now();
  if (queryCache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, item] of queryCache.entries()) {
      if (now > item.expiresAt) {
        queryCache.delete(k);
      }
    }
  }
  while (queryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = queryCache.keys().next().value;
    if (oldestKey === undefined) break;
    queryCache.delete(oldestKey);
  }
  queryCache.set(key, {
    results,
    expiresAt: now + CACHE_TTL_MS
  });
}

function provider(actionOrOptions, maybeParams) {
  let action;
  let params;
  if (typeof actionOrOptions === 'object' && actionOrOptions !== null) {
    action = actionOrOptions.type || actionOrOptions.action;
    params = actionOrOptions;
  } else {
    action = actionOrOptions;
    params = maybeParams || {};
  }

  const apiKey = (process.env.PLACES_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('Place search is not configured.');
    err.name = 'ConfigError';
    err.statusCode = 503;
    return Promise.reject(err);
  }

  let path;
  if (action === 'autocomplete' || action === 'search') {
    const text = params.text || params.q || params.query || '';
    const limit = params.limit || 5;
    path = `/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&filter=countrycode:in&limit=${encodeURIComponent(limit)}&apiKey=${encodeURIComponent(apiKey)}`;
  } else if (action === 'reverse') {
    const lat = params.lat;
    const lon = params.lon;
    path = `/v1/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&apiKey=${encodeURIComponent(apiKey)}`;
  } else {
    const err = new Error('Unsupported provider action');
    err.name = 'ProviderError';
    err.statusCode = 400;
    return Promise.reject(err);
  }

  const options = {
    hostname: 'api.geoapify.com',
    path,
    method: 'GET',
    headers: {
      'User-Agent': 'EasyFinRecoveryApp/1.0'
    },
    timeout: 5000
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error('Provider returned non-200 status');
          err.name = 'ProviderError';
          err.statusCode = res.statusCode;
          return reject(err);
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          const err = new Error('Invalid JSON from provider');
          err.name = 'ParseError';
          err.statusCode = 502;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Provider request timed out');
      err.name = 'TimeoutError';
      err.code = 'ETIMEDOUT';
      err.statusCode = 504;
      reject(err);
    });

    req.on('error', (e) => {
      const err = new Error('Provider request failed');
      err.name = e.name || 'NetworkError';
      err.code = e.code;
      err.statusCode = 502;
      reject(err);
    });

    req.end();
  });
}

function formatFeature(feature) {
  const p = feature.properties || {};
  const coords = feature.geometry && feature.geometry.coordinates;
  const longitude = (p.lon !== undefined && p.lon !== null)
    ? p.lon
    : (coords && coords[0] !== undefined ? coords[0] : null);
  const latitude = (p.lat !== undefined && p.lat !== null)
    ? p.lat
    : (coords && coords[1] !== undefined ? coords[1] : null);

  const parts = [p.name, p.street, p.city, p.state, p.country].filter(Boolean);
  const displayName = p.formatted || parts.join(', ');
  const name = p.formatted || p.name || displayName || '';

  return {
    name,
    displayName,
    latitude,
    longitude,
    city: p.city || '',
    state: p.state || '',
    country: p.country || '',
    type: p.result_type || p.category || p.type || p.osm_type || ''
  };
}

const getProvider = () => exports.provider || provider;

function photonSearch(query) {
  return getProvider()('autocomplete', { text: query, limit: 5 });
}

function photonReverse(lat, lon) {
  return getProvider()('reverse', { lat, lon });
}

// GET /recovery/places/search?q=...
exports.searchPlaces = async (req, res) => {
  try {
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const agentKey = agentId ? agentId.toString() : req.ip;

    if (isRateLimited(agentKey)) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please wait a moment.' });
    }

    const query = String(req.query.q || '').trim();
    if (!query || query.length < 3) {
      return res.status(400).json({ success: false, message: 'Query must be at least 3 characters.' });
    }
    if (query.length > 200) {
      return res.status(400).json({ success: false, message: 'Query too long.' });
    }

    const cacheKey = query.toLowerCase();
    const cached = getCached(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, results: cached });
    }

    const apiKey = (process.env.PLACES_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({ success: false, message: 'Place search is not configured.' });
    }

    const data = await getProvider()('autocomplete', { text: query, limit: 5 });
    const features = (data && data.features ? data.features : []).slice(0, 5);
    const results = features.map(formatFeature);

    setCached(cacheKey, results);

    return res.status(200).json({ success: true, results });
  } catch (error) {
    if (error.statusCode === 503 || error.name === 'ConfigError') {
      return res.status(503).json({ success: false, message: 'Place search is not configured.' });
    }
    const errType = error.name || error.code || 'Error';
    const errStatus = error.statusCode || 502;
    console.error(`searchPlaces error: type=${errType}, status=${errStatus}`);
    return res.status(502).json({ success: false, message: 'Places search unavailable. Please try again.' });
  }
};

// GET /recovery/places/reverse?lat=...&lon=...
exports.reverseGeocode = async (req, res) => {
  try {
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const agentKey = agentId ? agentId.toString() : req.ip;

    if (isRateLimited(agentKey)) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please wait a moment.' });
    }

    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ success: false, message: 'Invalid lat/lon.' });
    }

    const apiKey = (process.env.PLACES_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({ success: false, message: 'Place search is not configured.' });
    }

    const data = await getProvider()('reverse', { lat, lon });
    const features = (data && data.features ? data.features : []).slice(0, 1);
    const results = features.map(formatFeature);

    return res.status(200).json({ success: true, results });
  } catch (error) {
    if (error.statusCode === 503 || error.name === 'ConfigError') {
      return res.status(503).json({ success: false, message: 'Place search is not configured.' });
    }
    const errType = error.name || error.code || 'Error';
    const errStatus = error.statusCode || 502;
    console.error(`reverseGeocode error: type=${errType}, status=${errStatus}`);
    return res.status(502).json({ success: false, message: 'Reverse geocoding unavailable. Please try again.' });
  }
};

exports.provider = provider;
exports.photonSearch = photonSearch;
exports.photonReverse = photonReverse;
exports._queryCache = queryCache;
exports._agentRequests = agentRequests;
