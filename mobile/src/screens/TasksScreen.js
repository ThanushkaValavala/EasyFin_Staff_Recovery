import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Modal, Image, TextInput,
  Linking
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { apiGet, apiPost } from '../api';
import { API_URL } from '../config';
import { getCachedAudio } from '../utils/offlineStore';
import { VOICE_NOTES_ENABLED } from '../config/features';

let activeTasksVoicePlayer = null;

const fmtDuration = (sec) => {
  if (!sec || isNaN(sec)) return '0m';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
};

const fmtDistance = (meters) => {
  if (!meters || isNaN(meters)) return '0.00 km';
  const km = Number(meters) / 1000;
  return `${km.toFixed(2)} km`;
};

export default function TasksScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('ASSIGNED'); // 'ASSIGNED' | 'COMPLETED'
  const [assignedTasks, setAssignedTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [locationsList, setLocationsList] = useState(['All Locations']);
  const [selectedLocation, setSelectedLocation] = useState('All Locations');
  const [locationSearchInput, setLocationSearchInput] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);

  // Multi-selection for visit planning (Assigned)
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);

  // Filters for Completed Tasks
  const [completedDateFilter, setCompletedDateFilter] = useState('ALL'); // 'ALL' | 'TODAY' | 'WEEK'

  // Loading & refresh states
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [error, setError] = useState('');

  // Audio Playback in Completed Tasks
  const [playingSessionId, setPlayingSessionId] = useState(null);
  const [audioLoadingSessionId, setAudioLoadingSessionId] = useState(null);
  const currentPlayerRef = useRef(null);

  // Image Modal
  const [modalImageUri, setModalImageUri] = useState(null);

  // Detail Modal for Completed Task
  const [selectedCompletedDetail, setSelectedCompletedDetail] = useState(null);

  // Stop voice playback helper
  const stopVoicePlayback = () => {
    if (currentPlayerRef.current) {
      try {
        currentPlayerRef.current.pause();
        currentPlayerRef.current.remove();
      } catch (_) {}
      currentPlayerRef.current = null;
    }
    setPlayingSessionId(null);
    setAudioLoadingSessionId(null);
  };

  useEffect(() => {
    return () => {
      stopVoicePlayback();
    };
  }, []);

  // Fetch Assigned Tasks, Completed Tasks, and Available Locations
  const loadData = useCallback(async () => {
    setError('');
    try {
      // 1. Fetch available locations
      try {
        const locRes = await apiGet('/tasks/locations');
        if (locRes && locRes.locations) {
          setLocationsList(locRes.locations);
        }
      } catch (_) {}

      // 2. Fetch assigned tasks
      const locQuery = selectedLocation && selectedLocation !== 'All Locations'
        ? `?location=${encodeURIComponent(selectedLocation)}`
        : '';
      const assignedRes = await apiGet(`/tasks/assigned${locQuery}`);
      if (assignedRes && assignedRes.tasks) {
        setAssignedTasks(assignedRes.tasks);
      }

      // 3. Fetch completed tasks
      let compQuery = '?';
      if (selectedLocation && selectedLocation !== 'All Locations') {
        compQuery += `location=${encodeURIComponent(selectedLocation)}&`;
      }
      if (completedDateFilter !== 'ALL') {
        compQuery += `date=${completedDateFilter}&`;
      }
      const compRes = await apiGet(`/tasks/completed${compQuery}`);
      if (compRes && compRes.completedTasks) {
        setCompletedTasks(compRes.completedTasks);
      }
    } catch (e) {
      console.error('[TasksScreen] loadData error:', e.message);
      setError(
        e.isNetworkError || e.message === 'Network request failed'
          ? 'Cannot reach the server. Please check your network connection.'
          : e.message
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedLocation, completedDateFilter]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Location suggestions search (Enter Location)
  const searchLocationsOnline = async (query) => {
    setLocationSearchInput(query);
    const q = query.trim();
    if (q.length < 3) {
      setLocationSuggestions([]);
      return;
    }
    setIsSearchingLocation(true);
    try {
      const res = await apiGet(`/places/search?q=${encodeURIComponent(q)}`);
      if (res && res.results) {
        setLocationSuggestions(res.results.map((r) => r.displayName || r.name).slice(0, 5));
      }
    } catch (_) {
      // Filter from known locations
      const matches = locationsList.filter(
        (l) => l.toLowerCase() !== 'all locations' && l.toLowerCase().includes(q.toLowerCase())
      );
      setLocationSuggestions(matches);
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const handleSelectLocation = (loc) => {
    setSelectedLocation(loc);
    setLocationSearchInput('');
    setLocationSuggestions([]);
  };

  // Toggle multiple customer selection for visit planning
  const toggleSelectCustomer = (customerId) => {
    setSelectedCustomerIds((prev) => {
      if (prev.includes(customerId)) {
        return prev.filter((id) => id !== customerId);
      }
      return [...prev, customerId];
    });
  };

  // Start Recovery Action (Stage 1 Initiation)
  const handleStartRecovery = async (customer) => {
    stopVoicePlayback();
    setActionLoadingId(customer.customerId);
    try {
      const res = await apiPost(`/tasks/${customer.customerId}/start`, {});
      if (res && res.success) {
        // Navigate to existing StartRecovery transport selection screen
        navigation.navigate('StartRecovery', {
          customer: res.customer || customer,
          customerId: customer.customerId,
          sessionId: res.session?.sessionId,
          area: customer.location || customer.area || '',
          plannedLocation: {
            name: customer.fullAddress || customer.location || 'Customer Location',
            latitude: customer.latitude || 0,
            longitude: customer.longitude || 0
          },
          plannedPersonCount: 1,
          plannedNames: [customer.customerName]
        });
      } else {
        Alert.alert('Cannot Start Recovery', res?.message || 'Failed to start recovery.');
      }
    } catch (err) {
      const errMsg = err?.data?.message || err.message || 'Could not start recovery.';
      if (err.status === 409 || errMsg.includes('another recovery agent')) {
        Alert.alert(
          'Customer Locked',
          'This customer is currently being handled by another recovery agent.'
        );
      } else {
        Alert.alert('Error', errMsg);
      }
    } finally {
      setActionLoadingId(null);
      loadData();
    }
  };

  // Task-level End Recovery Action (Stage 2 Completion)
  const handleEndRecoveryTask = async (customer) => {
    stopVoicePlayback();
    Alert.alert(
      'Complete Task',
      `Move ${customer.customerName} to Completed Tasks? This will finalize the task and release the recovery lock.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Recovery',
          style: 'default',
          onPress: async () => {
            setActionLoadingId(customer.customerId);
            try {
              const res = await apiPost(`/tasks/${customer.customerId}/complete`, {});
              if (res && res.success) {
                Alert.alert(
                  'Task Completed',
                  `${customer.customerName} has been moved to Completed Tasks.`
                );
                loadData();
              } else {
                Alert.alert('Completion Error', res?.message || 'Could not complete task.');
              }
            } catch (e) {
              Alert.alert('Error', e?.data?.message || e.message || 'Failed to complete task.');
            } finally {
              setActionLoadingId(null);
            }
          }
        }
      ]
    );
  };

  // Play audio for Completed Task
  const playVoiceNote = async (item) => {
    const sessionId = item.sessionId;
    if (!sessionId) return;

    if (playingSessionId === sessionId) {
      stopVoicePlayback();
      return;
    }

    stopVoicePlayback();
    setAudioLoadingSessionId(sessionId);

    try {
      const localAudioPath = await getCachedAudio(sessionId, async (id) => {
        const res = await apiGet(`/recovery/sessions/${id}/voice-url`);
        return res?.url || res?.signedUrl || res?.voiceUrl || item.voiceNoteUrl;
      });

      if (!localAudioPath) {
        Alert.alert('Voice Note', 'Voice recording audio is not available.');
        setAudioLoadingSessionId(null);
        return;
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false
      });

      const player = createAudioPlayer(localAudioPath);
      currentPlayerRef.current = player;
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          setPlayingSessionId(null);
          player.seekTo(0).catch(() => {});
        }
      });
      player.play();
      setPlayingSessionId(sessionId);
    } catch (err) {
      console.warn('playVoiceNote error:', err.message);
      Alert.alert('Playback Error', 'Could not play voice note.');
    } finally {
      setAudioLoadingSessionId(null);
    }
  };

  const openPhone = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {});
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Top App Bar (Purple Theme) ── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Tasks</Text>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => {
            setRefreshing(true);
            loadData();
          }}
        >
          <Ionicons name="refresh" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* ── 1. Enter Location Section ── */}
      <View style={styles.locationSection}>
        <View style={styles.locationHeaderRow}>
          <Ionicons name="location" size={18} color="#7C3AED" />
          <Text style={styles.locationSectionTitle}>Enter Location</Text>
          {selectedLocation !== 'All Locations' && (
            <TouchableOpacity onPress={() => handleSelectLocation('All Locations')}>
              <Text style={styles.clearLocText}>Clear Filter</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Search Input */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#64748B" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search location (e.g. Sarjapur, Kasavanahalli)"
            placeholderTextColor="#94A3B8"
            value={locationSearchInput}
            onChangeText={searchLocationsOnline}
            autoCapitalize="none"
          />
          {locationSearchInput.length > 0 && (
            <TouchableOpacity onPress={() => { setLocationSearchInput(''); setLocationSuggestions([]); }}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
          {isSearchingLocation && (
            <ActivityIndicator size="small" color="#7C3AED" style={{ marginLeft: 6 }} />
          )}
        </View>

        {/* Suggestion dropdown if searching */}
        {locationSuggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {locationSuggestions.map((sug, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.suggestionItem}
                onPress={() => handleSelectLocation(sug)}
              >
                <Ionicons name="location-outline" size={16} color="#7C3AED" style={{ marginRight: 8 }} />
                <Text style={styles.suggestionText} numberOfLines={1}>{sug}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Locality Chips: Sarjapur, Kasavanahalli, Marathahalli, All Locations */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.locationChipsScroll}
        >
          {locationsList.map((loc) => {
            const isSelected = selectedLocation.toLowerCase() === loc.toLowerCase();
            return (
              <TouchableOpacity
                key={loc}
                style={[styles.locChip, isSelected && styles.locChipActive]}
                onPress={() => handleSelectLocation(loc)}
              >
                <Text style={[styles.locChipText, isSelected && styles.locChipTextActive]}>
                  {loc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Segmented Tabs: Assigned Tasks vs Completed Tasks ── */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'ASSIGNED' && styles.tabButtonActive]}
          onPress={() => {
            stopVoicePlayback();
            setActiveTab('ASSIGNED');
          }}
        >
          <Ionicons
            name="clipboard"
            size={18}
            color={activeTab === 'ASSIGNED' ? '#7C3AED' : '#64748B'}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.tabText, activeTab === 'ASSIGNED' && styles.tabTextActive]}>
            Assigned Tasks ({assignedTasks.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'COMPLETED' && styles.tabButtonActive]}
          onPress={() => {
            stopVoicePlayback();
            setActiveTab('COMPLETED');
          }}
        >
          <Ionicons
            name="checkmark-circle"
            size={18}
            color={activeTab === 'COMPLETED' ? '#7C3AED' : '#64748B'}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.tabText, activeTab === 'COMPLETED' && styles.tabTextActive]}>
            Completed Tasks ({completedTasks.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Error Banner ── */}
      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color="#DC2626" style={{ marginRight: 6 }} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Main Scroll View ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={styles.loadingText}>Loading tasks...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadData();
              }}
              colors={['#7C3AED']}
            />
          }
        >
          {/* ══════════════════════════════════════════════════════════════ */}
          {/* ASSIGNED TASKS TAB                                             */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'ASSIGNED' && (
            <View>
              {/* Visit Planning Multi-Select Banner */}
              {selectedCustomerIds.length > 0 && (
                <View style={styles.planningBanner}>
                  <View style={styles.planningBannerRow}>
                    <Ionicons name="calendar-outline" size={20} color="#7C3AED" />
                    <Text style={styles.planningBannerText}>
                      Visit Planning: {selectedCustomerIds.length} customer
                      {selectedCustomerIds.length === 1 ? '' : 's'} selected
                    </Text>
                    <TouchableOpacity onPress={() => setSelectedCustomerIds([])}>
                      <Text style={styles.planningClearText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.planningBannerSub}>
                    Select individual customer to start active recovery. Selection does not lock sessions.
                  </Text>
                </View>
              )}

              {assignedTasks.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="folder-open-outline" size={48} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No Assigned Tasks</Text>
                  <Text style={styles.emptySub}>
                    {selectedLocation !== 'All Locations'
                      ? `No assigned customers found for ${selectedLocation}.`
                      : 'All customer recovery tasks are completed or none assigned.'}
                  </Text>
                  {selectedLocation !== 'All Locations' && (
                    <TouchableOpacity
                      style={styles.emptyActionBtn}
                      onPress={() => handleSelectLocation('All Locations')}
                    >
                      <Text style={styles.emptyActionBtnText}>Show All Locations</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                assignedTasks.map((cust) => {
                  const isChecked = selectedCustomerIds.includes(cust.customerId);
                  const isBusy = actionLoadingId === cust.customerId;

                  // Recovery Status Badge styling
                  let statusLabel = 'ASSIGNED';
                  let statusBg = '#EFF6FF';
                  let statusColor = '#2563EB';

                  if (cust.isLockedByOther) {
                    statusLabel = `RECOVERY IN PROGRESS — Handled by ${cust.activeAgentName || 'Agent'}`;
                    statusBg = '#FEF3C7';
                    statusColor = '#D97706';
                  } else if (cust.isLockedByMe) {
                    if (cust.canComplete) {
                      statusLabel = 'RECOVERY IN PROGRESS (Session Submitted)';
                      statusBg = '#EDE9FE';
                      statusColor = '#7C3AED';
                    } else {
                      statusLabel = 'RECOVERY IN PROGRESS (Active)';
                      statusBg = '#E0F2FE';
                      statusColor = '#0284C7';
                    }
                  } else if (cust.recoveryStatus === 'RECOVERY_IN_PROGRESS') {
                    statusLabel = 'RECOVERY IN PROGRESS';
                    statusBg = '#FEF3C7';
                    statusColor = '#D97706';
                  }

                  return (
                    <View key={cust.customerId} style={styles.customerCard}>
                      <View style={styles.cardMainRow}>
                        {/* Checkbox for visit planning */}
                        <TouchableOpacity
                          style={styles.checkboxContainer}
                          onPress={() => toggleSelectCustomer(cust.customerId)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons
                            name={isChecked ? 'checkbox' : 'square-outline'}
                            size={24}
                            color={isChecked ? '#7C3AED' : '#94A3B8'}
                          />
                        </TouchableOpacity>

                        <View style={{ flex: 1 }}>
                          {/* Top: Customer Name & Status Pill */}
                          <View style={styles.customerHeaderRow}>
                            <Text style={styles.customerName}>{cust.customerName}</Text>
                          </View>

                          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
                            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                              {statusLabel}
                            </Text>
                          </View>

                          {/* Phone Number with Call Action */}
                          <TouchableOpacity
                            style={styles.infoRow}
                            onPress={() => openPhone(cust.phoneNumber)}
                          >
                            <Ionicons name="call" size={14} color="#7C3AED" style={{ marginRight: 6 }} />
                            <Text style={styles.phoneText}>{cust.phoneNumber}</Text>
                            <Text style={styles.callLinkText}>(Call)</Text>
                          </TouchableOpacity>

                          {/* Full Address */}
                          <View style={styles.infoRow}>
                            <Ionicons name="location-outline" size={14} color="#64748B" style={{ marginRight: 6, marginTop: 2 }} />
                            <Text style={styles.addressText}>{cust.fullAddress}</Text>
                          </View>

                          {/* Locality Tag */}
                          <View style={styles.localityTag}>
                            <Ionicons name="business-outline" size={12} color="#7C3AED" style={{ marginRight: 4 }} />
                            <Text style={styles.localityTagText}>{cust.location || cust.area || 'Bangalore'}</Text>
                          </View>
                        </View>
                      </View>

                      {/* Card Action Button Section */}
                      <View style={styles.cardActionRow}>
                        {cust.isLockedByOther ? (
                          <View style={[styles.actionBtn, styles.actionBtnDisabled]}>
                            <Ionicons name="lock-closed" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
                            <Text style={styles.actionBtnDisabledText}>Locked by Another Agent</Text>
                          </View>
                        ) : cust.canComplete ? (
                          /* Stage 2 Action: Separate task-level End Recovery button */
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.actionBtnEndRecovery]}
                            onPress={() => handleEndRecoveryTask(cust)}
                            disabled={isBusy}
                          >
                            {isBusy ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <>
                                <Ionicons name="checkmark-done-circle" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                                <Text style={styles.actionBtnText}>End Recovery</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        ) : cust.isLockedByMe ? (
                          /* Active recovery in progress by this agent */
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.actionBtnResume]}
                            onPress={() => handleStartRecovery(cust)}
                            disabled={isBusy}
                          >
                            {isBusy ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <>
                                <Ionicons name="play" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                                <Text style={styles.actionBtnText}>Resume Recovery</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        ) : (
                          /* Normal: Start Recovery */
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.actionBtnStart]}
                            onPress={() => handleStartRecovery(cust)}
                            disabled={isBusy}
                          >
                            {isBusy ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <>
                                <Ionicons name="navigate-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                                <Text style={styles.actionBtnText}>Start Recovery</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* COMPLETED TASKS TAB                                            */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'COMPLETED' && (
            <View>
              {/* Date Filter Pills */}
              <View style={styles.completedFilterRow}>
                {[
                  { key: 'ALL', label: 'All Dates' },
                  { key: 'TODAY', label: 'Today' },
                  { key: 'WEEK', label: 'Past 7 Days' }
                ].map((d) => (
                  <TouchableOpacity
                    key={d.key}
                    style={[
                      styles.filterPill,
                      completedDateFilter === d.key && styles.filterPillActive
                    ]}
                    onPress={() => setCompletedDateFilter(d.key)}
                  >
                    <Text
                      style={[
                        styles.filterPillText,
                        completedDateFilter === d.key && styles.filterPillTextActive
                      ]}
                    >
                      {d.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {completedTasks.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="checkmark-done-circle-outline" size={48} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No Completed Tasks</Text>
                  <Text style={styles.emptySub}>
                    Completed recovery tasks will be stored here with audio playback, speedometer images and audit records.
                  </Text>
                </View>
              ) : (
                completedTasks.map((task) => {
                  const isPlaying = playingSessionId === task.sessionId;
                  const isAudioLoading = audioLoadingSessionId === task.sessionId;

                  return (
                    <TouchableOpacity
                      key={task.taskId || task.id}
                      style={styles.completedCard}
                      activeOpacity={0.92}
                      onPress={() => setSelectedCompletedDetail(task)}
                    >
                      {/* Top Header: Customer Name and Green Completion Tick */}
                      <View style={styles.completedCardHeader}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.customerName}>{task.customerName}</Text>
                          <Text style={styles.completedIdSub}>ID: {task.customerRefId}</Text>
                        </View>
                        <Ionicons name="checkmark-circle" size={26} color="#16A34A" />
                      </View>

                      {/* Contact & Address */}
                      <View style={styles.infoRow}>
                        <Ionicons name="call-outline" size={14} color="#64748B" style={{ marginRight: 6 }} />
                        <Text style={styles.completedDetailText}>{task.phoneNumber}</Text>
                      </View>

                      <View style={styles.infoRow}>
                        <Ionicons name="location-outline" size={14} color="#64748B" style={{ marginRight: 6, marginTop: 2 }} />
                        <Text style={styles.addressText}>{task.fullAddress}</Text>
                      </View>

                      {/* Locality & Agent Details */}
                      <View style={styles.agentInfoBox}>
                        <Text style={styles.agentInfoLabel}>
                          Recovered by: <Text style={styles.agentInfoValue}>{task.recoveryAgentName}</Text> ({task.recoveryAgentPhone})
                        </Text>
                        <Text style={styles.completedTimestamp}>
                          Completed: {task.completionDate} at {task.completionTime}
                        </Text>
                      </View>

                      {/* Metrics: Distance, Duration, Outcome */}
                      <View style={styles.metricsRow}>
                        <View style={styles.metricItem}>
                          <Text style={styles.metricLabel}>DISTANCE</Text>
                          <Text style={styles.metricValue}>{fmtDistance(task.distanceMeters)}</Text>
                        </View>
                        <View style={styles.metricItem}>
                          <Text style={styles.metricLabel}>DURATION</Text>
                          <Text style={styles.metricValue}>{fmtDuration(task.durationSeconds)}</Text>
                        </View>
                        <View style={styles.metricItem}>
                          <Text style={styles.metricLabel}>OUTCOME</Text>
                          <Text style={styles.metricValueOutcome}>{task.outcome || 'COMPLETED'}</Text>
                        </View>
                      </View>

                      {/* Voice Note Audio Playback */}
                      {VOICE_NOTES_ENABLED && (task.voiceNoteUrl || task.voiceStoragePath) && (
                        <View style={styles.voicePlayerBox}>
                          <TouchableOpacity
                            style={styles.voicePlayBtn}
                            onPress={() => playVoiceNote(task)}
                            disabled={isAudioLoading}
                          >
                            {isAudioLoading ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <Ionicons
                                name={isPlaying ? 'pause' : 'play'}
                                size={18}
                                color="#FFFFFF"
                              />
                            )}
                          </TouchableOpacity>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.voicePlayerTitle}>
                              {isPlaying ? 'Playing Voice Recording...' : 'Recovery Voice Remarks'}
                            </Text>
                            <Text style={styles.voicePlayerSub}>
                              Cached audio with offline & server fallback
                            </Text>
                          </View>
                        </View>
                      )}

                      {/* Speedometer Image Thumbnails */}
                      {(task.startSpeedometerEvidenceId || task.endSpeedometerEvidenceId) && (
                        <View style={styles.photosRow}>
                          {task.startSpeedometerEvidenceId && (
                            <TouchableOpacity
                              style={styles.photoThumbContainer}
                              onPress={() =>
                                setModalImageUri(`${API_URL}/recovery/evidence/${task.startSpeedometerEvidenceId}/image`)
                              }
                            >
                              <Image
                                source={{ uri: `${API_URL}/recovery/evidence/${task.startSpeedometerEvidenceId}/image` }}
                                style={styles.photoThumb}
                              />
                              <Text style={styles.photoThumbLabel}>Start Speedo</Text>
                            </TouchableOpacity>
                          )}
                          {task.endSpeedometerEvidenceId && (
                            <TouchableOpacity
                              style={styles.photoThumbContainer}
                              onPress={() =>
                                setModalImageUri(`${API_URL}/recovery/evidence/${task.endSpeedometerEvidenceId}/image`)
                              }
                            >
                              <Image
                                source={{ uri: `${API_URL}/recovery/evidence/${task.endSpeedometerEvidenceId}/image` }}
                                style={styles.photoThumb}
                              />
                              <Text style={styles.photoThumbLabel}>End Speedo</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      {/* Tap to View Detail Hint */}
                      <View style={styles.detailHintRow}>
                        <Text style={styles.detailHintText}>Tap card to view complete history details</Text>
                        <Ionicons name="chevron-forward" size={14} color="#7C3AED" />
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Modal 1: Full-Size Image Preview ── */}
      <Modal visible={!!modalImageUri} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalImageUri(null)}>
            <Ionicons name="close-circle" size={36} color="#FFFFFF" />
          </TouchableOpacity>
          {modalImageUri && (
            <Image
              source={{ uri: modalImageUri }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* ── Modal 2: Completed Task Detailed Record ── */}
      <Modal visible={!!selectedCompletedDetail} animationType="slide">
        <View style={[styles.detailModalContainer, { paddingTop: insets.top + 10 }]}>
          <View style={styles.detailModalHeader}>
            <Text style={styles.detailModalTitle}>Task Details</Text>
            <TouchableOpacity onPress={() => setSelectedCompletedDetail(null)}>
              <Ionicons name="close" size={26} color="#0F172A" />
            </TouchableOpacity>
          </View>

          {selectedCompletedDetail && (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={styles.detailModalTopCard}>
                <Ionicons name="checkmark-circle" size={40} color="#16A34A" style={{ alignSelf: 'center', marginBottom: 8 }} />
                <Text style={styles.detailModalCustomerName}>{selectedCompletedDetail.customerName}</Text>
                <Text style={styles.detailModalCustomerPhone}>{selectedCompletedDetail.phoneNumber}</Text>
                <Text style={styles.detailModalCustomerAddr}>{selectedCompletedDetail.fullAddress}</Text>
              </View>

              <Text style={styles.detailSectionTitle}>Recovery Summary</Text>
              <View style={styles.detailInfoBox}>
                <View style={styles.detailRowItem}>
                  <Text style={styles.detailRowLabel}>Session ID:</Text>
                  <Text style={styles.detailRowVal}>{selectedCompletedDetail.sessionId}</Text>
                </View>
                <View style={styles.detailRowItem}>
                  <Text style={styles.detailRowLabel}>Completed On:</Text>
                  <Text style={styles.detailRowVal}>{selectedCompletedDetail.completionDate} {selectedCompletedDetail.completionTime}</Text>
                </View>
                <View style={styles.detailRowItem}>
                  <Text style={styles.detailRowLabel}>Agent:</Text>
                  <Text style={styles.detailRowVal}>{selectedCompletedDetail.recoveryAgentName}</Text>
                </View>
                <View style={styles.detailRowItem}>
                  <Text style={styles.detailRowLabel}>Distance:</Text>
                  <Text style={styles.detailRowVal}>{fmtDistance(selectedCompletedDetail.distanceMeters)}</Text>
                </View>
                <View style={styles.detailRowItem}>
                  <Text style={styles.detailRowLabel}>Duration:</Text>
                  <Text style={styles.detailRowVal}>{fmtDuration(selectedCompletedDetail.durationSeconds)}</Text>
                </View>
                <View style={styles.detailRowItem}>
                  <Text style={styles.detailRowLabel}>Outcome:</Text>
                  <Text style={styles.detailRowVal}>{selectedCompletedDetail.outcome}</Text>
                </View>
                {(selectedCompletedDetail.visitRemarks || selectedCompletedDetail.visitNotes) ? (
                  <View style={[styles.detailRowItem, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                    <Text style={styles.detailRowLabel}>Remarks:</Text>
                    <Text style={[styles.detailRowVal, { marginTop: 4 }]}>
                      {selectedCompletedDetail.visitRemarks || selectedCompletedDetail.visitNotes}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Close Button */}
              <TouchableOpacity
                style={styles.detailCloseBtn}
                onPress={() => setSelectedCompletedDetail(null)}
              >
                <Text style={styles.detailCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#64748B', fontWeight: '500' },

  // Top Bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#7C3AED',
    paddingHorizontal: 16,
    paddingVertical: 14,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4
  },
  topBarTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  refreshBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },

  // Enter Location Section
  locationSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  locationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  locationSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginLeft: 6,
    flex: 1
  },
  clearLocText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0F172A' },
  suggestionsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 3,
    maxHeight: 160
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  suggestionText: { fontSize: 13, color: '#1E293B', flex: 1 },
  locationChipsScroll: { paddingVertical: 8 },
  locChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  locChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  locChipText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  locChipTextActive: { color: '#FFFFFF' },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent'
  },
  tabButtonActive: { borderBottomColor: '#7C3AED' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  tabTextActive: { color: '#7C3AED' },

  // Planning Banner
  planningBanner: {
    backgroundColor: '#EDE9FE',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#C4B5FD'
  },
  planningBannerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planningBannerText: { fontSize: 14, fontWeight: '800', color: '#6D28D9', flex: 1, marginLeft: 8 },
  planningClearText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  planningBannerSub: { fontSize: 11, color: '#5B21B6', marginTop: 4 },

  // Customer Cards (Assigned)
  contentScroll: { flex: 1 },
  customerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6
  },
  cardMainRow: { flexDirection: 'row', alignItems: 'flex-start' },
  checkboxContainer: { marginRight: 12, marginTop: 2 },
  customerHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  customerName: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
    marginBottom: 8
  },
  statusBadgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  phoneText: { fontSize: 13, fontWeight: '700', color: '#7C3AED' },
  callLinkText: { fontSize: 11, fontWeight: '600', color: '#2563EB', marginLeft: 4 },
  addressText: { fontSize: 12, color: '#475569', flex: 1, lineHeight: 17 },
  localityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 8
  },
  localityTagText: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },

  // Card Action Buttons
  cardActionRow: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12
  },
  actionBtn: {
    flexDirection: 'row',
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center'
  },
  actionBtnStart: { backgroundColor: '#7C3AED' },
  actionBtnResume: { backgroundColor: '#0284C7' },
  actionBtnEndRecovery: { backgroundColor: '#16A34A' },
  actionBtnDisabled: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  actionBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  actionBtnDisabledText: { color: '#94A3B8', fontSize: 14, fontWeight: '700' },

  // Completed Cards
  completedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 5,
    borderLeftColor: '#16A34A',
    elevation: 2
  },
  completedCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  completedIdSub: { fontSize: 11, color: '#64748B', fontWeight: '600', marginTop: 2 },
  completedDetailText: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  agentInfoBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  agentInfoLabel: { fontSize: 12, color: '#475569' },
  agentInfoValue: { fontWeight: '700', color: '#0F172A' },
  completedTimestamp: { fontSize: 11, color: '#64748B', marginTop: 4, fontWeight: '500' },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 10
  },
  metricItem: { alignItems: 'center', flex: 1 },
  metricLabel: { fontSize: 9, fontWeight: '800', color: '#64748B' },
  metricValue: { fontSize: 13, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  metricValueOutcome: { fontSize: 12, fontWeight: '800', color: '#16A34A', marginTop: 2 },

  // Voice Player Box
  voicePlayerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DDD6FE'
  },
  voicePlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center'
  },
  voicePlayerTitle: { fontSize: 12, fontWeight: '800', color: '#6D28D9' },
  voicePlayerSub: { fontSize: 10, color: '#7C3AED', marginTop: 1 },

  // Photos Row
  photosRow: { flexDirection: 'row', marginTop: 10 },
  photoThumbContainer: { marginRight: 10, alignItems: 'center' },
  photoThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#E2E8F0' },
  photoThumbLabel: { fontSize: 10, color: '#64748B', marginTop: 3, fontWeight: '600' },

  detailHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 10
  },
  detailHintText: { fontSize: 11, fontWeight: '700', color: '#7C3AED', marginRight: 4 },

  // Completed Filters
  completedFilterRow: { flexDirection: 'row', marginBottom: 12 },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8
  },
  filterPillActive: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  filterPillText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  filterPillTextActive: { color: '#FFFFFF' },

  // Empty state
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginTop: 12 },
  emptySub: { fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 6, lineHeight: 18 },
  emptyActionBtn: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#7C3AED',
    borderRadius: 8
  },
  emptyActionBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5'
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '500', flex: 1 },

  // Modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalCloseBtn: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
  modalImage: { width: '92%', height: '75%' },

  detailModalContainer: { flex: 1, backgroundColor: '#F8FAFC' },
  detailModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  detailModalTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  detailModalTopCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center'
  },
  detailModalCustomerName: { fontSize: 20, fontWeight: '800', color: '#0F172A', textAlign: 'center' },
  detailModalCustomerPhone: { fontSize: 14, fontWeight: '700', color: '#7C3AED', marginTop: 4 },
  detailModalCustomerAddr: { fontSize: 13, color: '#475569', textAlign: 'center', marginTop: 6 },
  detailSectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  detailInfoBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20
  },
  detailRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  detailRowLabel: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  detailRowVal: { fontSize: 13, color: '#0F172A', fontWeight: '700' },
  detailCloseBtn: {
    backgroundColor: '#7C3AED',
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10
  },
  detailCloseBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }
});
