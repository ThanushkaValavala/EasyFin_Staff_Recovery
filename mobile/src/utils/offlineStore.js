/**
 * Durable offline storage for recovery sessions.
 * Pending sessions are stored in SecureStore and synchronized to the backend
 * when connectivity is restored.
 *
 * For Bike/Car sessions, both starting and ending speedometer photo URIs are preserved
 * locally and uploaded during sync before the session is removed from the pending queue.
 */
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { apiPost, apiUploadFile, apiUploadFiles } from '../api';

async function getReadableAddress(p) {
  if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return '';
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 5000)
    );
    const geocodePromise = Location.reverseGeocodeAsync({
      latitude: p.latitude,
      longitude: p.longitude,
    });
    const r = await Promise.race([geocodePromise, timeoutPromise]);
    if (r && r[0]) {
      const a = r[0];
      const cityOrSub = a.subregion || a.city || '';
      const parts = [a.name, a.street, cityOrSub].filter(Boolean);
      const uniqueParts = parts.filter((part, idx) => parts.indexOf(part) === idx);
      return uniqueParts.join(', ') || '';
    }
  } catch (e) {}
  return '';
}

const PENDING_KEY = 'pending_recovery_sessions';
const HISTORY_CACHE_KEY = 'cached_recovery_history';

let _syncInProgress = false;

// ── Read / write pending list ────────────────────────────────────────────────

async function readPending() {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[offlineStore] readPending error:', e.message);
    return [];
  }
}

async function writePending(list) {
  const json = JSON.stringify(list);
  await SecureStore.setItemAsync(PENDING_KEY, json);
  // Verify write succeeded
  const check = await SecureStore.getItemAsync(PENDING_KEY);
  if (!check && list.length > 0) {
    throw new Error('Failed to verify pending session storage write');
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Save a completed session locally (pending sync).
 * Preserves all metadata, GPS points, and photo URIs.
 */
export async function savePendingSession(session) {
  if (!session || !session.deviceSessionId) {
    throw new Error('deviceSessionId is required to save pending recovery');
  }

  const list = await readPending();
  const exists = list.some((s) => s.deviceSessionId === session.deviceSessionId);
  if (!exists) {
    list.push({ ...session, _syncStatus: 'PENDING' });
    await writePending(list);
    console.log(
      '[offlineStore] Saved pending session:',
      session.deviceSessionId,
      'mode:', session.transportMode || session.vehicleType,
      'startPhoto:', session.startPhotoUri ? 'present' : 'none',
      'endPhoto:', session.endPhotoUri ? 'present' : 'none',
      'points:', (session.points || []).length
    );
  }
}

/**
 * Return all locally stored pending sessions.
 */
export async function getPendingSessions() {
  return readPending();
}

/**
 * Attempt to sync all pending sessions to the backend.
 *
 * Prevents multiple simultaneous sync runs.
 *
 * For WALK / OTHER:
 *   - Synchronizes metadata and GPS points via POST /recovery/sync (no photo).
 *
 * For BIKE / CAR:
 *   - If started online (has real backend sessionId), uploads ending photo via
 *     POST /recovery/sessions/:sessionId/finish and GPS points via points endpoint.
 *   - If started offline (full offline session), uploads BOTH startPhoto and endPhoto
 *     plus all metadata and GPS points via POST /recovery/sync (multipart).
 *   - Retains session in queue if either required photo is missing.
 *
 * Each session is removed from the local queue ONLY after verified server success.
 * Returns { synced, failed, inProgress }.
 */
export async function syncPendingSessions() {
  if (_syncInProgress) {
    console.log('[offlineStore] Sync already in progress, skipping concurrent trigger');
    return { synced: 0, failed: 0, inProgress: true };
  }

  _syncInProgress = true;
  try {
    const list = await readPending();
    if (!list.length) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;
    const remaining = [];

    for (const session of list) {
      try {
        let startAddress = session.startAddress || '';
        let endAddress = session.endAddress || '';
        if (!startAddress && session.startLocation) {
          try {
            startAddress = await getReadableAddress(session.startLocation);
          } catch (e) {}
        }
        if (!endAddress && session.endLocation) {
          try {
            endAddress = await getReadableAddress(session.endLocation);
          } catch (e) {}
        }
        startAddress = startAddress || '';
        endAddress = endAddress || '';

        const mode = String(session.transportMode || session.vehicleType || 'WALK').toUpperCase();
        const isWalkLike = mode === 'WALK' || mode === 'OTHER';
        const needsPhotos = mode === 'BIKE' || mode === 'CAR';

        // Check if session was started online (real backend sessionId)
        const hasBackendSession = session.sessionId &&
          String(session.sessionId).startsWith('SESS-') &&
          session.sessionId !== session.deviceSessionId &&
          !String(session.sessionId).startsWith('SESS-SYNC-');

        if (needsPhotos) {
          // If session was started online: start photo is already on server.
          // Only the end photo needs to be uploaded to finish the session.
          if (hasBackendSession && session.endPhotoUri) {
            console.log('[offlineStore] Syncing online-started Bike/Car session with end photo:', session.sessionId);
            const endLoc = session.endLocation || {};
            await apiUploadFile(
              `/recovery/sessions/${session.sessionId}/finish`,
              {
                remarks: session.remarks || session.rawRemarks || '',
                distanceMeters: String(Math.round(session.distanceMeters || 0)),
                durationSeconds: String(Math.round(session.durationSeconds || 0)),
                movingSeconds: session.movingSeconds != null ? String(Math.round(session.movingSeconds)) : '',
                idleSeconds: session.idleSeconds != null ? String(Math.round(session.idleSeconds)) : '',
                unknownSeconds: session.unknownSeconds != null ? String(Math.round(session.unknownSeconds)) : '',
                startAddress,
                endAddress,
                endLocation: JSON.stringify({
                  latitude: endLoc.latitude || 0,
                  longitude: endLoc.longitude || 0,
                  accuracy: endLoc.accuracy || 0,
                }),
                nlpDetails: session.nlpDetails || '',
              },
              'endPhoto',
              session.endPhotoUri
            );

            // Flush points if any were captured locally
            if (Array.isArray(session.points) && session.points.length > 0) {
              await apiPost(`/recovery/sessions/${session.sessionId}/points`, {
                points: session.points,
                incrementalDistanceMeters: 0,
              }).catch(() => {});
            }

            console.log('[offlineStore] Confirmed sync for online session:', session.sessionId);
            synced++;
            continue;
          }

          // Fully offline Bike/Car recovery: requires BOTH starting and ending photos
          if (!session.startPhotoUri || !session.endPhotoUri) {
            console.warn(
              '[offlineStore] Cannot sync Bike/Car recovery without both photos:',
              session.deviceSessionId,
              'start:', !!session.startPhotoUri,
              'end:', !!session.endPhotoUri
            );
            failed++;
            remaining.push(session);
            continue;
          }

          console.log('[offlineStore] Syncing full offline Bike/Car recovery with both photos:', session.deviceSessionId);
          await apiUploadFiles(
            '/recovery/sync',
            {
              deviceSessionId: session.deviceSessionId,
              sessionId: session.sessionId,
              vehicleType: mode,
              vehicleNumber: session.vehicleNumber || '',
              startTime: session.startTime,
              endTime: session.endTime,
              durationSeconds: String(Math.round(session.durationSeconds || 0)),
              distanceMeters: String(Math.round(session.distanceMeters || 0)),
              movingSeconds: session.movingSeconds != null ? String(Math.round(session.movingSeconds)) : '',
              idleSeconds: session.idleSeconds != null ? String(Math.round(session.idleSeconds)) : '',
              unknownSeconds: session.unknownSeconds != null ? String(Math.round(session.unknownSeconds)) : '',
              startAddress,
              endAddress,
              remarks: session.remarks || session.rawRemarks || '',
              startLocation: JSON.stringify(session.startLocation || null),
              endLocation: JSON.stringify(session.endLocation || null),
              points: JSON.stringify(session.points || []),
              nlpDetails: session.nlpDetails || '',
            },
            {
              startPhoto: session.startPhotoUri,
              endPhoto: session.endPhotoUri,
            }
          );

          console.log('[offlineStore] Confirmed sync for full offline Bike/Car session:', session.deviceSessionId);
          synced++;
        } else {
          // WALK or OTHER: sync without photos
          console.log(`[offlineStore] Syncing ${mode} session (no photo required):`, session.deviceSessionId);
          await apiPost('/recovery/sync', {
            ...session,
            vehicleType: mode,
            movingSeconds: session.movingSeconds != null ? Math.round(session.movingSeconds) : null,
            idleSeconds: session.idleSeconds != null ? Math.round(session.idleSeconds) : null,
            unknownSeconds: session.unknownSeconds != null ? Math.round(session.unknownSeconds) : null,
            startAddress,
            endAddress,
            points: session.points || [],
          });

          console.log(`[offlineStore] Confirmed sync for ${mode} session:`, session.deviceSessionId);
          synced++;
        }
      } catch (err) {
        console.warn('[offlineStore] sync failed for', session.deviceSessionId, '—', err.message);
        failed++;
        remaining.push(session);
      }
    }

    await writePending(remaining);
    return { synced, failed };
  } finally {
    _syncInProgress = false;
  }
}

// ── History cache (fallback when backend is unreachable) ─────────────────────

export async function cacheHistory(sessions) {
  try {
    await SecureStore.setItemAsync(HISTORY_CACHE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[offlineStore] cacheHistory error:', e.message);
  }
}

export async function getCachedHistory() {
  try {
    const raw = await SecureStore.getItemAsync(HISTORY_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[offlineStore] getCachedHistory error:', e.message);
    return [];
  }
}
