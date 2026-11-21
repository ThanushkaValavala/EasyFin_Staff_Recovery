import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, TextInput, Modal, Image, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { apiGet } from '../api';
import { API_URL } from '../config';
import { BADGE_COLORS } from '../utils/nlpSummarizer';
import { cacheHistory, getCachedHistory, getPendingSessions, syncPendingSessions, getCachedAudio } from '../utils/offlineStore';

let activeProfileVoiceCard = null; // { sessionId, stop() }

const fmtVoiceDuration = (s) => {
  if (s == null || isNaN(s)) return '';
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const memoryAddressCache = new Map();
const signedUrlCache = new Map();

async function getPhotoUrl(evidenceId) {
  if (!evidenceId) return null;
  if (signedUrlCache.has(evidenceId)) return signedUrlCache.get(evidenceId);
  try {
    const res = await apiGet(`/recovery/evidence/${evidenceId}/url`);
    const url = res?.url || res?.signedUrl;
    if (url) {
      signedUrlCache.set(evidenceId, url);
      return url;
    }
  } catch (e) { }
  return null;
}

const CHIPS = ['Today', 'Last 7 days', 'This month', 'All'];

function toLocalDateKey(d) {
  if (!d) return null;
  const x = new Date(d);
  if (isNaN(x.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

function keyToDisplay(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}-${m}-${y}`;
}

function parseUserDate(str) {
  if (!str || str.length !== 10) return null;
  const [dd, mm, yyyy] = str.split('-');
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(yyyy, 10);
  if (isNaN(d) || isNaN(m) || isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31 || y < 2000) return null;
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function formatDDMMYYYY(date) {
  if (!date || isNaN(date.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}-${p(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function chipRange(chip) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (chip === 'Today') {
    return { from: today, to: endOfDay(today) };
  }
  if (chip === 'Last 7 days') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from, to: endOfDay(today) };
  }
  if (chip === 'This month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from, to: endOfDay(today) };
  }
  return { from: null, to: null };
}

const fmtDate = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
};

const fmtTime = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  const h = x.getHours() % 12 || 12;
  return `${p(h)}:${p(x.getMinutes())} ${x.getHours() < 12 ? 'AM' : 'PM'}`;
};

const fmtDuration = (s) => {
  if (!s && s !== 0) return '-';
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return (h > 0 ? `${h}h ` : '') + `${pad(m)}m`;
};

const fmtIdleTime = (s) => {
  if (s == null) return '-';
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  if (h > 0) return `${h}h ${m}m ${remSec}s`;
  if (m > 0) return `${m}m ${remSec}s`;
  return `${remSec}s`;
};

const fmtDistance = (m) => {
  if (!m && m !== 0) return '-';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
};

function NlpBadge({ category, summary }) {
  const colors = BADGE_COLORS[category] || BADGE_COLORS.GENERAL;
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {summary || ''}
      </Text>
    </View>
  );
}

function InfoRow({ icon, label, value, wrapValue }) {
  return (
    <View style={[styles.infoRow, wrapValue && styles.infoRowWrap]}>
      <View style={[styles.infoLabelGroup, wrapValue && { flexShrink: 0 }]}>
        <Ionicons name={icon} size={14} color="#64748B" style={{ marginRight: 6 }} />
        <Text style={styles.infoLabel}>{label}:</Text>
      </View>
      {wrapValue ? (
        <View style={styles.infoValueWrapContainer}>
          <Text style={styles.infoValueWrap} numberOfLines={2} ellipsizeMode="tail">{value || '-'}</Text>
        </View>
      ) : (
        <Text style={styles.infoValue} numberOfLines={1}>{value || '-'}</Text>
      )}
    </View>
  );
}

// Cache entry: { source: { uri: string, headers?: object }, fetchedAt: number, isSigned: boolean }
const evidenceSourceCache = new Map();
const evidenceInFlightCache = new Map();

export async function resolveEvidenceSource(evidenceId, forceFresh = false) {
  if (!evidenceId) return null;
  const now = Date.now();
  if (!forceFresh && evidenceSourceCache.has(evidenceId)) {
    const cached = evidenceSourceCache.get(evidenceId);
    // Non-signed URLs (/image) never expire. Signed URLs expire after 300s, treat as expired after 240s (4 mins)
    if (!cached.isSigned || (now - cached.fetchedAt < 240000)) {
      return cached.source;
    }
  }
  if (!forceFresh && evidenceInFlightCache.has(evidenceId)) {
    return evidenceInFlightCache.get(evidenceId);
  }

  const promise = (async () => {
    // 1. Ask for secured link
    try {
      const res = await apiGet(`/recovery/evidence/${evidenceId}/url`);
      if (res && res.url) {
        const src = { uri: res.url };
        evidenceSourceCache.set(evidenceId, { source: src, fetchedAt: Date.now(), isSigned: true });
        return src;
      }
    } catch (_e) {
      // Direct image fallback for MongoDB-stored evidence or network/url failure
    }

    // 2. Load /recovery/evidence/:id/image with Authorization header (no expiry)
    try {
      const token = await SecureStore.getItemAsync('token');
      const src = {
        uri: `${API_URL}/recovery/evidence/${evidenceId}/image`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      };
      evidenceSourceCache.set(evidenceId, { source: src, fetchedAt: Date.now(), isSigned: false });
      return src;
    } catch (_err) {
      return null;
    } finally {
      evidenceInFlightCache.delete(evidenceId);
    }
  })();

  evidenceInFlightCache.set(evidenceId, promise);
  return promise;
}

export function SpeedometerThumbnail({ label, evidenceId, localUri, onOpen }) {
  const [source, setSource] = useState(() => {
    if (localUri) return { uri: localUri };
    if (evidenceId && evidenceSourceCache.has(evidenceId)) {
      const c = evidenceSourceCache.get(evidenceId);
      if (!c.isSigned || (Date.now() - c.fetchedAt < 240000)) {
        return c.source;
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(() => {
    if (localUri) return false;
    if (evidenceId && evidenceSourceCache.has(evidenceId)) {
      const c = evidenceSourceCache.get(evidenceId);
      if (!c.isSigned || (Date.now() - c.fetchedAt < 240000)) {
        return false;
      }
    }
    return !!evidenceId;
  });
  const [loadError, setLoadError] = useState(false);
  const retriedRef = useRef(false);

  useEffect(() => {
    let active = true;
    retriedRef.current = false;
    if (localUri) {
      setSource({ uri: localUri });
      setLoading(false);
      setLoadError(false);
      return;
    }
    if (!evidenceId) {
      setLoading(false);
      return;
    }

    const cached = evidenceSourceCache.get(evidenceId);
    if (cached && (!cached.isSigned || (Date.now() - cached.fetchedAt < 240000))) {
      setSource(cached.source);
      setLoading(false);
      setLoadError(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    resolveEvidenceSource(evidenceId)
      .then((src) => {
        if (!active) return;
        if (src) {
          setSource(src);
        } else {
          setLoadError(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [evidenceId, localUri]);

  const handleImageError = () => {
    // Retry once with a fresh request when signed image fails to load
    if (!retriedRef.current && evidenceId) {
      retriedRef.current = true;
      setLoading(true);
      resolveEvidenceSource(evidenceId, true)
        .then((src) => {
          if (src) {
            setSource(src);
            setLoadError(false);
          } else {
            setLoadError(true);
          }
        })
        .catch(() => {
          setLoadError(true);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoadError(true);
    }
  };

  return (
    <View style={styles.thumbnailContainer}>
      <TouchableOpacity
        style={styles.thumbnailWrapper}
        onPress={() => {
          if (source && !loadError && !loading) {
            onOpen(source);
          }
        }}
        disabled={loading || loadError || !source}
        activeOpacity={0.8}
      >
        {loading ? (
          <View style={styles.thumbnailPlaceholder}>
            <ActivityIndicator size="small" color="#94A3B8" />
          </View>
        ) : loadError || !source ? (
          <View style={styles.thumbnailPlaceholder}>
            <Ionicons name="videocam-off-outline" size={22} color="#94A3B8" />
          </View>
        ) : (
          <Image
            source={source}
            style={styles.thumbnailImage}
            resizeMode="cover"
            onError={handleImageError}
          />
        )}
      </TouchableOpacity>
      <Text style={styles.thumbnailCaption}>{label}</Text>
    </View>
  );
}

function SessionCard({ session }) {
  const [modalImage, setModalImage] = useState(null);

  const startEvidenceId = session.startSpeedometerEvidenceId;
  const startLocalUri = session.startPhotoUri;
  const endEvidenceId = session.endSpeedometerEvidenceId;
  const endLocalUri = session.endPhotoUri;

  const hasStart = !!(startEvidenceId || startLocalUri);
  const hasEnd = !!(endEvidenceId || endLocalUri);
  const hasAnyPhoto = hasStart || hasEnd;

  const vehicleLabel = session.vehicleType
    ? session.vehicleType.charAt(0).toUpperCase() + session.vehicleType.slice(1).toLowerCase()
    : 'Walk';

  const nlpCategory = session.nlpCategory || 'GENERAL';
  const nlpSummary = session.nlpSummary || '';
  const isPending = session._syncStatus === 'PENDING';

  const startLoc = session.startLocation ? `${session.startLocation.latitude?.toFixed(4)}, ${session.startLocation.longitude?.toFixed(4)}` : null;
  const endLoc = session.endLocation ? `${session.endLocation.latitude?.toFixed(4)}, ${session.endLocation.longitude?.toFixed(4)}` : null;

  // Customer met display
  const hasMetField = session.customerMet != null;
  let visitedLabel = null;
  if (hasMetField) {
    if (session.customerMet === true || session.customerMet === 'true') {
      const names = Array.isArray(session.customerNames) && session.customerNames.length > 0
        ? session.customerNames.join(', ')
        : null;
      visitedLabel = names ? `Visited: ${names}` : 'Visited the customer';
    } else {
      visitedLabel = 'Not visited';
    }
  }

  // Voice note
  const hasVoice = Boolean(session.voicePath || session.voiceUri);
  const sessionIdForVoice = session.sessionId || session._id || session.deviceSessionId;
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const cardPlayerRef = useRef(null);

  const stopVoicePlayback = useCallback(() => {
    if (cardPlayerRef.current) {
      try {
        cardPlayerRef.current.pause();
        cardPlayerRef.current.remove();
      } catch (_) {}
      cardPlayerRef.current = null;
    }
    setVoicePlaying(false);
    setVoiceLoading(false);
    if (activeProfileVoiceCard && activeProfileVoiceCard.sessionId === sessionIdForVoice) {
      activeProfileVoiceCard = null;
    }
  }, [sessionIdForVoice]);

  useEffect(() => {
    return () => {
      stopVoicePlayback();
    };
  }, [stopVoicePlayback]);

  const handleToggleVoice = async () => {
    setVoiceError(false);
    if (voicePlaying) {
      stopVoicePlayback();
      return;
    }

    if (activeProfileVoiceCard && activeProfileVoiceCard.sessionId !== sessionIdForVoice) {
      try {
        activeProfileVoiceCard.stop();
      } catch (_) {}
    }
    activeProfileVoiceCard = { sessionId: sessionIdForVoice, stop: stopVoicePlayback };

    setVoiceLoading(true);
    try {
      let localAudioPath = null;
      if (session.voiceUri && session.voiceUri.startsWith('file://')) {
        localAudioPath = session.voiceUri;
      } else if (sessionIdForVoice) {
        localAudioPath = await getCachedAudio(sessionIdForVoice, async (id) => {
          const res = await apiGet(`/recovery/sessions/${id}/voice-url`);
          return res?.url || res?.signedUrl || res?.voiceUrl;
        });
      }

      if (!localAudioPath) {
        setVoiceError(true);
        setVoiceLoading(false);
        return;
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });

      if (cardPlayerRef.current) {
        try {
          cardPlayerRef.current.remove();
        } catch (_) {}
      }

      const player = createAudioPlayer(localAudioPath);
      cardPlayerRef.current = player;
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          setVoicePlaying(false);
          player.seekTo(0).catch(() => {});
        }
      });
      player.play();
      setVoicePlaying(true);
    } catch (_err) {
      setVoiceError(true);
    } finally {
      setVoiceLoading(false);
    }
  };

  const [lazyStartAddress, setLazyStartAddress] = useState(
    () => session.startAddress || (session.startLocation ? memoryAddressCache.get(`${session.startLocation.latitude},${session.startLocation.longitude}`) : null)
  );
  const [lazyEndAddress, setLazyEndAddress] = useState(
    () => session.endAddress || (session.endLocation ? memoryAddressCache.get(`${session.endLocation.latitude},${session.endLocation.longitude}`) : null)
  );

  const [startPhotoUrl, setStartPhotoUrl] = useState(() => session.startPhotoUri || null);
  const [endPhotoUrl, setEndPhotoUrl] = useState(() => session.endPhotoUri || null);
  const [routePhotoUrl, setRoutePhotoUrl] = useState(() => session.routePhotoUri || null);

  useEffect(() => {
    let active = true;

    const startEvId = session.startSpeedometerEvidenceId ||
      (Array.isArray(session.evidence) && session.evidence.find((e) => e.kind === 'START_SPEEDOMETER')?.evidenceId);
    if (!session.startPhotoUri && startEvId) {
      getPhotoUrl(startEvId).then((url) => {
        if (active && url) setStartPhotoUrl(url);
      });
    }

    const endEvId = session.endSpeedometerEvidenceId ||
      (Array.isArray(session.evidence) && session.evidence.find((e) => e.kind === 'END_SPEEDOMETER')?.evidenceId);
    if (!session.endPhotoUri && endEvId) {
      getPhotoUrl(endEvId).then((url) => {
        if (active && url) setEndPhotoUrl(url);
      });
    }

    const routeEvId = session.routeEvidenceId ||
      (Array.isArray(session.evidence) && session.evidence.find((e) => e.kind === 'ROUTE')?.evidenceId);
    if (!session.routePhotoUri && routeEvId) {
      getPhotoUrl(routeEvId).then((url) => {
        if (active && url) setRoutePhotoUrl(url);
      });
    }

    return () => { active = false; };
  }, [
    session.startPhotoUri, session.endPhotoUri, session.routePhotoUri,
    session.startSpeedometerEvidenceId, session.endSpeedometerEvidenceId, session.routeEvidenceId,
    session.evidence,
  ]);

  useEffect(() => {
    let active = true;
    if (!session.startAddress && session.startLocation?.latitude != null && session.startLocation?.longitude != null) {
      const key = `${session.startLocation.latitude},${session.startLocation.longitude}`;
      if (memoryAddressCache.has(key)) {
        setLazyStartAddress(memoryAddressCache.get(key));
      } else {
        Location.reverseGeocodeAsync({
          latitude: session.startLocation.latitude,
          longitude: session.startLocation.longitude,
        }).then((r) => {
          if (!active) return;
          if (r && r[0]) {
            const a = r[0];
            const cityOrSub = a.subregion || a.city || '';
            const parts = [a.name, a.street, cityOrSub].filter(Boolean);
            const line = parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
            if (line) {
              memoryAddressCache.set(key, line);
              setLazyStartAddress(line);
            }
          }
        }).catch(() => { });
      }
    }

    if (!session.endAddress && session.endLocation?.latitude != null && session.endLocation?.longitude != null) {
      const key = `${session.endLocation.latitude},${session.endLocation.longitude}`;
      if (memoryAddressCache.has(key)) {
        setLazyEndAddress(memoryAddressCache.get(key));
      } else {
        Location.reverseGeocodeAsync({
          latitude: session.endLocation.latitude,
          longitude: session.endLocation.longitude,
        }).then((r) => {
          if (!active) return;
          if (r && r[0]) {
            const a = r[0];
            const cityOrSub = a.subregion || a.city || '';
            const parts = [a.name, a.street, cityOrSub].filter(Boolean);
            const line = parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
            if (line) {
              memoryAddressCache.set(key, line);
              setLazyEndAddress(line);
            }
          }
        }).catch(() => { });
      }
    }

    return () => { active = false; };
  }, [session.startAddress, session.endAddress, session.startLocation, session.endLocation]);

  const displayStart = session.startAddress || lazyStartAddress || startLoc;
  const displayEnd = session.endAddress || lazyEndAddress || endLoc;

  return (
    <View style={[styles.sessionCard, isPending && styles.sessionCardPending]}>
      {isPending ? (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-upload-outline" size={13} color="#92400E" style={{ marginRight: 4 }} />
          <Text style={styles.pendingText}>Pending Sync to Cloud</Text>
        </View>
      ) : null}

      <View style={styles.sessionHeader}>
        <View style={styles.dateBadge}>
          <Ionicons name="calendar-outline" size={13} color="#2563EB" style={{ marginRight: 4 }} />
          <Text style={styles.dateText}>{fmtDate(session.endTime || session.startTime)}</Text>
        </View>
        <View style={[styles.modeBadge, {
          backgroundColor: vehicleLabel === 'Walk' ? '#DCFCE7' : '#EFF6FF',
          borderColor: vehicleLabel === 'Walk' ? '#86EFAC' : '#BFDBFE',
        }]}>
          <Text style={[styles.modeText, {
            color: vehicleLabel === 'Walk' ? '#15803D' : '#1E40AF',
          }]}>{vehicleLabel}</Text>
        </View>
      </View>

      {/* NLP Summary Badge: shown only for old recoveries with no customerMet field */}
      {!hasMetField ? (
        <NlpBadge category={nlpCategory} summary={nlpSummary} />
      ) : null}

      {/* Voice note row (shown for new recoveries that have audio) */}
      {hasVoice ? (
        <View style={styles.voiceNoteRow}>
          <View style={styles.voiceNoteLeft}>
            <Ionicons name="mic" size={16} color="#475569" style={{ marginRight: 6 }} />
            <Text style={styles.voiceNoteLabel}>
              Voice note{session.voiceDurationSeconds ? ` (${fmtVoiceDuration(session.voiceDurationSeconds)})` : ''}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.voicePlayBtn}
            onPress={handleToggleVoice}
            disabled={voiceLoading}
            activeOpacity={0.7}
          >
            {voiceLoading ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <>
                <Ionicons
                  name={voicePlaying ? 'pause-circle-outline' : 'play-circle-outline'}
                  size={18}
                  color="#2563EB"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.voicePlayBtnText}>{voicePlaying ? 'Pause' : 'Play'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
      {voiceError ? (
        <Text style={styles.voiceErrorText}>Could not play the recording.</Text>
      ) : null}

      {/* Customer visited label chip */}
      {visitedLabel ? (
        <View style={styles.visitedRow}>
          <Ionicons
            name={session.customerMet === true || session.customerMet === 'true' ? 'checkmark-circle-outline' : 'close-circle-outline'}
            size={14}
            color={session.customerMet === true || session.customerMet === 'true' ? '#059669' : '#DC2626'}
            style={{ marginRight: 6 }}
          />
          <Text style={[
            styles.visitedText,
            { color: session.customerMet === true || session.customerMet === 'true' ? '#15803D' : '#DC2626' },
          ]}>
            {visitedLabel}
          </Text>
        </View>
      ) : null}

      {/* Speedometer thumbnails */}
      {hasAnyPhoto ? (
        <View style={styles.speedometerSection}>
          <Text style={styles.speedometerSectionLabel}>Speedometer</Text>
          <View style={styles.speedometerThumbnailsRow}>
            {hasStart ? (
              <SpeedometerThumbnail
                label="Start"
                evidenceId={startEvidenceId}
                localUri={startLocalUri}
                onOpen={(src) => setModalImage({ source: src, title: 'Start Speedometer' })}
              />
            ) : null}
            {hasEnd ? (
              <SpeedometerThumbnail
                label="End"
                evidenceId={endEvidenceId}
                localUri={endLocalUri}
                onOpen={(src) => setModalImage({ source: src, title: 'End Speedometer' })}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Full-size photo Modal */}
      <Modal
        visible={!!modalImage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalImage(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{modalImage?.title || 'Speedometer'}</Text>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setModalImage(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalImageContainer}>
            {modalImage ? (
              <Image
                source={modalImage.source}
                style={styles.modalFullImage}
                resizeMode="contain"
              />
            ) : null}
          </View>
        </View>
      </Modal>

      <View style={styles.sessionInfoGrid}>
        <InfoRow icon="time-outline" label="Start Time" value={fmtTime(session.startTime)} />
        <InfoRow icon="checkmark-circle-outline" label="End Time" value={fmtTime(session.endTime)} />
        <InfoRow icon="hourglass-outline" label="Duration" value={fmtDuration(session.durationSeconds)} />
        <InfoRow icon="pause-circle-outline" label="Idle Time" value={fmtIdleTime(session.idleSeconds)} />
        <InfoRow icon="navigate-outline" label="Distance" value={fmtDistance(session.distanceMeters)} />
        {session.vehicleNumber ? (
          <InfoRow icon="car-outline" label="Vehicle Reg" value={session.vehicleNumber} />
        ) : null}
        {displayStart ? (
          <InfoRow icon="location-outline" label="Start Loc" value={displayStart} wrapValue />
        ) : null}
        {displayEnd ? (
          <InfoRow icon="flag-outline" label="End Loc" value={displayEnd} wrapValue />
        ) : null}
      </View>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const [staff, setStaff] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [pendingSessions, setPendingSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const s = await SecureStore.getItemAsync('staff');
      if (s) setStaff(JSON.parse(s));

      const pendings = await getPendingSessions();
      setPendingSessions(pendings || []);

      // Load profile info from /agent/profile or /auth/profile
      try {
        const profRes = await apiGet('/agent/profile');
        if (profRes && profRes.staff) {
          setStaff(profRes.staff);
          await SecureStore.setItemAsync('staff', JSON.stringify(profRes.staff));
        }
      } catch (pe) {
        try {
          const authProf = await apiGet('/auth/profile');
          if (authProf && authProf.staff) {
            setStaff(authProf.staff);
            await SecureStore.setItemAsync('staff', JSON.stringify(authProf.staff));
          }
        } catch (err2) { }
      }

      // Load recovery history for authenticated agent
      try {
        const res = await apiGet('/recovery/history');
        const list = res.sessions || [];
        setSessions(list);
        await cacheHistory(list);
        setIsOfflineMode(false);
      } catch (he) {
        console.warn('[ProfileScreen] History fetch failed, falling back to cache:', he.message);
        const cached = await getCachedHistory();
        setSessions(cached);
        setIsOfflineMode(true);
      }
    } catch (e) {
      console.warn('[ProfileScreen] loadData error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { synced, failed } = await syncPendingSessions();
      if (synced > 0) {
        Alert.alert('Sync Complete', `Successfully synced ${synced} pending recovery session(s).`);
      } else if (failed > 0) {
        Alert.alert('Sync Incomplete', `${failed} session(s) could not be synced. Check connectivity and retry.`);
      } else {
        Alert.alert('Sync Status', 'All recovery records are already up to date.');
      }
      await loadData();
    } catch (e) {
      Alert.alert('Sync Error', e.message || 'Could not synchronize.');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await SecureStore.deleteItemAsync('token');
          await SecureStore.deleteItemAsync('staff');
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };

  // Combine pending offline sessions with backend sessions
  const allSessions = [
    ...pendingSessions.filter(p => !sessions.some(s => s.sessionId === p.sessionId || s.deviceSessionId === p.deviceSessionId)),
    ...sessions,
  ];

  // ── Recoveries Per Day Filter State ─────────────────────────────────────────
  const [selectedChip, setSelectedChip] = useState('Last 7 days');
  const [fromText, setFromText] = useState(() => {
    const { from } = chipRange('Last 7 days');
    return formatDDMMYYYY(from);
  });
  const [toText, setToText] = useState(() => {
    const { to } = chipRange('Last 7 days');
    return formatDDMMYYYY(to);
  });
  const [rangeError, setRangeError] = useState('');
  const [expandedDays, setExpandedDays] = useState({});

  function handleChip(chip) {
    setSelectedChip(chip);
    setRangeError('');
    const { from, to } = chipRange(chip);
    setFromText(from ? formatDDMMYYYY(from) : '');
    setToText(to ? formatDDMMYYYY(to) : '');
  }

  function handleClear() {
    setSelectedChip('All');
    setRangeError('');
    setFromText('');
    setToText('');
  }

  function handleFromChange(text) {
    setFromText(text);
    setSelectedChip('');
    setRangeError('');
  }

  function handleToChange(text) {
    setToText(text);
    setSelectedChip('');
    setRangeError('');
  }

  const { fromDate, toDate, error } = useMemo(() => {
    if (selectedChip === 'All' || (!fromText && !toText)) {
      return { fromDate: null, toDate: null, error: '' };
    }
    if (selectedChip && selectedChip !== 'All') {
      const { from, to } = chipRange(selectedChip);
      return { fromDate: from, toDate: to, error: '' };
    }
    const from = parseUserDate(fromText);
    const to = parseUserDate(toText);
    if (!fromText && !toText) return { fromDate: null, toDate: null, error: '' };
    if (fromText && !from) return { fromDate: null, toDate: null, error: 'Invalid "From" date. Use DD-MM-YYYY.' };
    if (toText && !to) return { fromDate: null, toDate: null, error: 'Invalid "To" date. Use DD-MM-YYYY.' };
    const toEnd = to ? endOfDay(to) : null;
    if (from && toEnd && from > toEnd) {
      return { fromDate: null, toDate: null, error: 'From date must be before To date.' };
    }
    return { fromDate: from || null, toDate: toEnd || null, error: '' };
  }, [selectedChip, fromText, toText]);

  const activeError = rangeError || error;

  const { rows, totalInRange } = useMemo(() => {
    const counts = {};
    const sessionsMap = {};

    for (const session of allSessions) {
      const rawDate = session.startTime || session.endTime;
      const key = toLocalDateKey(rawDate);
      if (!key) continue;

      if (fromDate || toDate) {
        const sessionDate = new Date(rawDate);
        if (fromDate && sessionDate < fromDate) continue;
        if (toDate && sessionDate > toDate) continue;
      }

      counts[key] = (counts[key] || 0) + 1;
      if (!sessionsMap[key]) sessionsMap[key] = [];
      sessionsMap[key].push(session);
    }

    // Day rows sorted with newest day first
    const sortedKeys = Object.keys(counts).sort((a, b) => b.localeCompare(a));
    const rows = sortedKeys.map((key) => {
      // Recoveries inside a day sorted with newest first
      const daySessions = (sessionsMap[key] || []).slice().sort((a, b) => {
        const timeA = new Date(a.endTime || a.startTime || 0).getTime();
        const timeB = new Date(b.endTime || b.startTime || 0).getTime();
        return timeB - timeA;
      });
      return { dateKey: key, count: counts[key], sessions: daySessions };
    });
    const totalInRange = rows.reduce((sum, r) => sum + r.count, 0);

    return { rows, totalInRange };
  }, [allSessions, fromDate, toDate]);

  const toggleDay = (key) => {
    setExpandedDays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); loadData(); }}
          colors={['#2563EB']}
        />
      }
    >
      {/* ── AGENT INFORMATION CARD ────────────────────────────────────── */}
      <View style={styles.profileCard}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{staff?.name?.charAt(0)?.toUpperCase() || 'A'}</Text>
          </View>
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Text style={styles.agentName}>{staff?.name || 'Recovery Agent'}</Text>
            <Text style={styles.agentRole}>Field Recovery Officer</Text>
            <View style={styles.phoneBadge}>
              <Ionicons name="call" size={12} color="#2563EB" style={{ marginRight: 4 }} />
              <Text style={styles.phoneText}>{staff?.phone || '-'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.profileMetaGrid}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Employee ID</Text>
            <Text style={styles.metaValue}>{staff?.employeeId || '-'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Assigned Zone</Text>
            <Text style={styles.metaValue}>{staff?.assignedArea || 'Main Branch'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Total Recoveries</Text>
            <Text style={styles.metaValue}>
              {typeof staff?.recoveryCount === 'number'
                ? staff.recoveryCount
                : allSessions.filter((s) => !s._syncStatus).length}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Total Distance</Text>
            <Text style={styles.metaValue}>
              {typeof staff?.totalDistanceKm === 'number'
                ? `${staff.totalDistanceKm.toFixed(2)} km`
                : '-'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={16} color="#DC2626" style={{ marginRight: 6 }} />
          <Text style={styles.logoutBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Sync Bar if pending sessions exist */}
      {pendingSessions.length > 0 ? (
        <View style={styles.syncNoticeBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.syncNoticeTitle}>
              {pendingSessions.length} Pending Offline Recovery{pendingSessions.length > 1 ? 'ies' : ''}
            </Text>
            <Text style={styles.syncNoticeSub}>Stored in SecureStore — ready to sync to MongoDB</Text>
          </View>
          <TouchableOpacity style={styles.syncNowBtn} onPress={handleSyncNow} disabled={syncing}>
            {syncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.syncNowBtnText}>Sync Now</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {isOfflineMode ? (
        <View style={styles.offlineNotice}>
          <Ionicons name="cloud-offline" size={16} color="#92400E" style={{ marginRight: 6 }} />
          <Text style={styles.offlineNoticeText}>Viewing cached recovery history (offline)</Text>
        </View>
      ) : null}

      {/* ── RECOVERIES PER DAY (INLINE SECTION) ────────────────────────── */}
      <View style={styles.recoveriesPerDaySection}>
        <View style={styles.historyHeaderRow}>
          <Text style={styles.historySectionTitle}>Recoveries Per Day</Text>
          <Text style={styles.historyCountText}>{totalInRange} In Range</Text>
        </View>

        {/* Filter card */}
        <View style={styles.filterCard}>
          {/* Quick chips */}
          <View style={styles.chipsRow}>
            {CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip}
                style={[styles.chip, selectedChip === chip && styles.chipActive]}
                onPress={() => handleChip(chip)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, selectedChip === chip && styles.chipTextActive]}>
                  {chip}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* From / To inputs */}
          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>From</Text>
              <TextInput
                style={styles.textInput}
                value={fromText}
                onChangeText={handleFromChange}
                placeholder="DD-MM-YYYY"
                keyboardType="numeric"
                maxLength={10}
                placeholderTextColor="#94A3B8"
              />
            </View>
            <View style={styles.inputSeparator} />
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>To</Text>
              <TextInput
                style={styles.textInput}
                value={toText}
                onChangeText={handleToChange}
                placeholder="DD-MM-YYYY"
                keyboardType="numeric"
                maxLength={10}
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          {/* Error message */}
          {activeError ? (
            <Text style={styles.errorText}>{activeError}</Text>
          ) : null}

          {/* Clear button */}
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear} activeOpacity={0.7}>
            <Ionicons name="close-circle-outline" size={14} color="#64748B" style={{ marginRight: 4 }} />
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Day rows list */}
        {rows.length === 0 ? (
          <View style={styles.emptyFilterCard}>
            <Ionicons name="calendar-outline" size={32} color="#94A3B8" />
            <Text style={styles.emptyFilterTitle}>No recoveries in this range</Text>
          </View>
        ) : (
          <View style={styles.dayListCard}>
            {rows.map((row, idx) => {
              const isExpanded = !!expandedDays[row.dateKey];
              return (
                <View key={row.dateKey} style={idx < rows.length - 1 && !isExpanded && styles.dayRowBorder}>
                  <TouchableOpacity
                    style={styles.dayRow}
                    onPress={() => toggleDay(row.dateKey)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.dayDate}>{keyToDisplay(row.dateKey)}</Text>
                    <View style={styles.dayRowRight}>
                      <Text style={styles.dayCount}>{row.count}</Text>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="#94A3B8"
                        style={{ marginLeft: 8 }}
                      />
                    </View>
                  </TouchableOpacity>
                  {isExpanded ? (
                    <View style={styles.dayExpandedList}>
                      {row.sessions.map((s, si) => (
                        <SessionCard
                          key={s._id || s.sessionId || s.deviceSessionId || si}
                          session={s}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* ── COMPLETED RECOVERY HISTORY ─────────────────────────────────── */}
      <View style={styles.historyHeaderRow}>
        <Text style={styles.historySectionTitle}>Completed Recovery History</Text>
        <Text style={styles.historyCountText}>{allSessions.length} Total</Text>
      </View>

      {allSessions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="time-outline" size={38} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No Completed Recoveries Yet</Text>
          <Text style={styles.emptySub}>Recoveries you complete will appear here with NLP summaries.</Text>
        </View>
      ) : (
        allSessions.map((session, idx) => (
          <SessionCard key={session._id || session.sessionId || session.deviceSessionId || idx} session={session} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 13, color: '#64748B' },
  profileCard: {
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#BFDBFE',
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: '#2563EB' },
  agentName: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  agentRole: { fontSize: 12, color: '#64748B', fontWeight: '500', marginTop: 2 },
  phoneBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
    alignSelf: 'flex-start', marginTop: 6,
  },
  phoneText: { fontSize: 12, fontWeight: '700', color: '#1E293B' },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 16 },
  profileMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 14, gap: 8 },
  metaItem: { minWidth: '30%' },
  metaLabel: { fontSize: 10, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  metaValue: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 8, backgroundColor: '#FEF2F2',
    borderWidth: 1, borderColor: '#FCA5A5',
  },
  logoutBtnText: { color: '#DC2626', fontSize: 13, fontWeight: '700' },
  syncNoticeBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7',
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FCD34D',
    marginBottom: 16,
  },
  syncNoticeTitle: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  syncNoticeSub: { fontSize: 11, color: '#B45309', marginTop: 2 },
  syncNowBtn: {
    backgroundColor: '#D97706', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, marginLeft: 10,
  },
  syncNowBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  offlineNotice: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC',
    padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  offlineNoticeText: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  historyHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  historySectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  historyCountText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  sessionCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
    overflow: 'hidden',
  },
  sessionCardPending: { borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    alignSelf: 'flex-start', marginBottom: 10,
  },
  pendingText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  sessionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  dateBadge: { flexDirection: 'row', alignItems: 'center' },
  dateText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  modeBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1,
  },
  modeText: { fontSize: 11, fontWeight: '800' },
  badge: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, marginBottom: 12, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  sessionInfoGrid: { gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoRowWrap: { alignItems: 'flex-start' },
  infoLabelGroup: { flexDirection: 'row', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  infoValue: { fontSize: 12, fontWeight: '600', color: '#0F172A' },
  infoValueWrapContainer: { flex: 1, minWidth: 0, alignItems: 'flex-end', marginLeft: 8 },
  infoValueWrap: { fontSize: 12, fontWeight: '600', color: '#0F172A', textAlign: 'right' },
  emptyCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 30,
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#334155', marginTop: 10 },
  emptySub: { fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 4 },
  visitedRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8FAFC', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8, alignSelf: 'flex-start',
  },
  visitedText: { fontSize: 12, fontWeight: '700' },
  voiceNoteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F8FAFC', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12,
  },
  voiceNoteLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  voiceNoteLabel: { fontSize: 13, fontWeight: '600', color: '#334155' },
  voicePlayBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EFF6FF', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  voicePlayBtnText: { fontSize: 13, fontWeight: '700', color: '#2563EB' },
  voiceErrorText: { fontSize: 12, color: '#DC2626', marginBottom: 8, marginTop: -4 },
  recoveriesPerDaySection: { marginBottom: 20 },
  filterCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 18,
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0',
  },
  chipActive: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' },
  chipText: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  chipTextActive: { color: '#2563EB' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: 10, fontWeight: '600', color: '#64748B', textTransform: 'uppercase', marginBottom: 3 },
  textInput: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6,
    fontSize: 12, fontWeight: '600', color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  inputSeparator: { width: 10 },
  errorText: { fontSize: 11, color: '#DC2626', fontWeight: '600', marginBottom: 6 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingVertical: 3, paddingHorizontal: 2,
  },
  clearBtnText: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  emptyFilterCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 24,
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 14,
  },
  emptyFilterTitle: { fontSize: 13, fontWeight: '600', color: '#64748B', marginTop: 8, textAlign: 'center' },
  dayListCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1,
    borderColor: '#E2E8F0', marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
    overflow: 'hidden',
  },
  dayRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  dayRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dayRowSeparator: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dayDate: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  dayRowRight: { flexDirection: 'row', alignItems: 'center' },
  dayCount: { fontSize: 15, fontWeight: '800', color: '#2563EB' },
  dayExpandedList: {
    paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6,
    backgroundColor: '#F8FAFC', borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },
  recoveriesPerDayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  recoveriesPerDayLeft: { flexDirection: 'row', alignItems: 'center' },
  recoveriesPerDayTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },

  // Customer-met / not-met blocks in SessionCard
  customerMetBlock: {
    backgroundColor: '#F0FDF4', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 12,
  },
  customerMetTitle: { fontSize: 13, fontWeight: '800', color: '#15803D', marginBottom: 4 },
  customerMetDetail: { fontSize: 12, fontWeight: '500', color: '#166534', marginTop: 2 },

  customerNotMetBlock: {
    backgroundColor: '#FEF2F2', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 12,
  },
  customerNotMetTitle: { fontSize: 13, fontWeight: '800', color: '#DC2626', marginBottom: 4 },
  customerNotMetDetail: { fontSize: 12, fontWeight: '500', color: '#991B1B', marginTop: 2 },

  // Speedometer row & modal in SessionCard
  speedometerSection: {
    marginTop: 6,
    marginBottom: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  speedometerSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  speedometerThumbnailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  thumbnailContainer: {
    alignItems: 'center',
  },
  thumbnailWrapper: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: 64,
    height: 64,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  modalImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalFullImage: {
    width: '100%',
    height: '100%',
  },
});
