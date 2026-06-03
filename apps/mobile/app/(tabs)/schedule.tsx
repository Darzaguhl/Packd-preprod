import { useEffect, useState, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, Pressable, ScrollView, ActivityIndicator,
  SafeAreaView, StyleSheet, RefreshControl,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { api } from '@/lib/api'
import type { SessionSlot } from '@packd/types'
import { sportColor } from '@/lib/constants'
import { useAuthReady } from '@/lib/useAuthReady'

const STUDIO_ID = process.env.EXPO_PUBLIC_STUDIO_ID!
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function weekMondayIso(ref: Date): string {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() || 7 // Mon=1..Sun=7
  d.setDate(d.getDate() - (dow - 1))
  return toIsoDate(d)
}

function addDaysToIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return toIsoDate(new Date(y, m - 1, d + n))
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function ScheduleScreen() {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionSlot[]>([])
  const [timezone, setTimezone] = useState('UTC')
  const [lateCancelWindowHours, setLateCancelWindowHours] = useState(0)
  const [lateCancelFeeCredits, setLateCancelFeeCredits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState(toIsoDate(new Date()))
  const [selectedSport, setSelectedSport] = useState('ALL')
const mondayIso = addDaysToIso(weekMondayIso(new Date()), weekOffset * 7)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysToIso(mondayIso, i))

  const [loadError, setLoadError] = useState(false)

  async function loadSessions(showSpinner = true) {
    if (showSpinner) setLoading(true)
    setLoadError(false)
    try {
      const monday = parseIso(mondayIso)
      const from = new Date(monday).toISOString()
      const to = new Date(monday.getTime() + WEEK_MS).toISOString()
      const data = await api.schedule.list(STUDIO_ID, from, to)
      setSessions(data.sessions)
      setTimezone(data.timezone ?? 'UTC')
      setLateCancelWindowHours(data.lateCancelWindowHours ?? 0)
      setLateCancelFeeCredits(data.lateCancelFeeCredits ?? 0)
    } catch {
      setSessions([])
      setLoadError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    // Current week → today, any other week → Monday of that week
    setSelectedDay(weekOffset === 0 ? toIsoDate(new Date()) : mondayIso)
    loadSessions()
  }, [weekOffset])

  // Refresh when tab comes back into focus (e.g. after booking)
  useFocusEffect(useCallback(() => {
    if (!loading) loadSessions(false)
  }, [weekOffset]))

  // On cold start, Supabase restores the session asynchronously after the first
  // schedule load. Reload silently once auth becomes available so booking status
  // (userBookingId / userStationId) appears without the user having to pull-to-refresh.
  useAuthReady(() => loadSessions(false))

  const sports = ['ALL', ...Array.from(new Set(sessions.map(s => s.sport))).sort()]

  const daySessions = sessions.filter(s => {
    const sessionDay = toIsoDate(new Date(s.startsAt))
    return sessionDay === selectedDay && (selectedSport === 'ALL' || s.sport === selectedSport)
  })

  function fmtDayLabel(iso: string) {
    const d = parseIso(iso)
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }
  function fmtDayNum(iso: string) {
    return String(parseIso(iso).getDate())
  }
  function sessionCountForDay(iso: string) {
    return sessions.filter(s => toIsoDate(new Date(s.startsAt)) === iso).length
  }

  function handleSessionPress(session: SessionSlot) {
    router.push({
      pathname: '/session/[id]',
      params: {
        id: session.id,
        roomId: session.roomId,
        studioId: session.studioId ?? STUDIO_ID,
        templateName: session.templateName,
        sport: session.sport,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        instructorName: session.instructorName,
        roomName: session.roomName,
        creditsRequired: String(session.creditsRequired),
        capacity: String(session.capacity),
        bookedCount: String(session.bookedCount),
        userBookingId: session.userBookingId ?? '',
        userStationId: session.userStationId ?? '',
        userWaitlistPosition: String(session.userWaitlistPosition ?? ''),
        lateCancelWindowHours: String(lateCancelWindowHours),
        lateCancelFeeCredits: String(lateCancelFeeCredits),
      },
    })
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.title}>Schedule</Text>
          {weekOffset !== 0 && (
            <Pressable
              onPress={() => { setWeekOffset(0); setSelectedDay(toIsoDate(new Date())) }}
              hitSlop={8}
              style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#4f46e5', borderRadius: 6 }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#fff' }}>Today</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.weekNav}>
          <Pressable
            onPress={() => setWeekOffset(w => Math.max(0, w - 1))}
            hitSlop={10}
            style={[styles.navBtn, weekOffset === 0 && { opacity: 0.25 }]}
            disabled={weekOffset === 0}
          >
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Text style={styles.weekLabel}>
            {parseIso(mondayIso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            {' – '}
            {parseIso(addDaysToIso(mondayIso, 6)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </Text>
          <Pressable onPress={() => setWeekOffset(w => w + 1)} hitSlop={10} style={styles.navBtn}>
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>
        </View>
      </View>

      {/* Day tabs — static row, each day takes equal width */}
      <View style={styles.dayTabs}>
        {weekDays.map(iso => {
          const active = iso === selectedDay
          const count = sessionCountForDay(iso)
          const isToday = iso === toIsoDate(new Date())
          return (
            <Pressable
              key={iso}
              onPress={() => setSelectedDay(iso)}
              style={[styles.dayTab, active && styles.dayTabActive]}
            >
              <Text style={[styles.dayTabLabel, active && styles.dayTabLabelActive]}>
                {fmtDayLabel(iso)}
              </Text>
              <Text style={[styles.dayTabNum, active && styles.dayTabNumActive, isToday && !active && styles.dayTabNumToday]}>
                {fmtDayNum(iso)}
              </Text>
              {count > 0 && (
                <View style={[styles.dayTabBadge, active && styles.dayTabBadgeActive]}>
                  <Text style={[styles.dayTabBadgeText, active && styles.dayTabBadgeTextActive]}>{count}</Text>
                </View>
              )}
            </Pressable>
          )
        })}
      </View>

      {/* Sport filter */}
      {sports.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sportFilterScroll} contentContainerStyle={styles.sportFilter}>
          {sports.map(sport => {
            const active = sport === selectedSport
            return (
              <Pressable
                key={sport}
                onPress={() => setSelectedSport(sport)}
                style={[
                  styles.sportPill,
                  active && { backgroundColor: sportColor(sport), borderColor: sportColor(sport) },
                ]}
              >
                <Text style={[styles.sportPillText, active && styles.sportPillTextActive]}>
                  {sport === 'ALL' ? 'All classes' : sport.charAt(0).toUpperCase() + sport.slice(1).toLowerCase()}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      {/* Session list */}
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color="#111827" />
      ) : (
        <FlatList
          data={daySessions}
          keyExtractor={s => s.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadSessions(false) }} tintColor="#111827" />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {loadError ? 'Could not load classes — pull down to retry' : 'No classes on this day'}
            </Text>
          }
          renderItem={({ item: s }) => {
            const isBooked = !!s.userBookingId
            const isWaitlisted = !!s.userWaitlistPosition
            const isFull = s.bookedCount >= s.capacity
            const spotsLeft = s.capacity - s.bookedCount
            const startTime = new Date(s.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
            const durationMin = Math.round((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000)
            const isPast = new Date(s.startsAt) < new Date()

            // Past classes — collapsed single row, not tappable
            if (isPast) {
              return (
                <View style={styles.cardPast}>
                  <View style={[styles.cardAccentThin, { backgroundColor: sportColor(s.sport) }]} />
                  <Text style={styles.cardPastTime}>{startTime}</Text>
                  <Text style={styles.cardPastName} numberOfLines={1}>{s.templateName}</Text>
                  <Text style={styles.cardPastMeta} numberOfLines={1}>{s.instructorName} · {durationMin}m</Text>
                </View>
              )
            }

            return (
              <Pressable
                onPress={() => handleSessionPress(s)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={[styles.cardAccent, { backgroundColor: sportColor(s.sport) }]} />
                <View style={styles.cardBody}>
                  <View style={styles.cardRow}>
                    <View>
                      <Text style={styles.cardTime}>{startTime}</Text>
                      <Text style={styles.cardDuration}>{durationMin}m</Text>
                    </View>
                    <View style={styles.cardMain}>
                      <Text style={styles.cardName}>{s.templateName}</Text>
                      <Text style={styles.cardMeta}>{s.instructorName} · {s.roomName}</Text>
                      <View style={styles.cardTags}>
                        <View style={[styles.sportTag, { backgroundColor: sportColor(s.sport) + '22', borderColor: sportColor(s.sport) + '55' }]}>
                          <Text style={[styles.sportTagText, { color: sportColor(s.sport) }]}>
                            {s.sport.charAt(0).toUpperCase() + s.sport.slice(1).toLowerCase()}
                          </Text>
                        </View>
                        <Text style={styles.cardCredits}>{s.creditsRequired} cr</Text>
                        <Text style={[styles.cardSpots, isFull && styles.cardSpotsFull]}>
                          {isFull ? 'Full' : `${spotsLeft} left`}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {(isBooked || isWaitlisted) && (
                    <View style={[styles.statusBadge, isBooked ? styles.statusBooked : styles.statusWaitlist]}>
                      <Text style={[styles.statusText, isBooked ? styles.statusTextBooked : styles.statusTextWaitlist]}>
                        {isBooked ? '✓ Booked' : `#${s.userWaitlistPosition} waitlist`}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  weekNav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navBtn: { padding: 6 },
  navBtnText: { fontSize: 22, color: '#374151', fontWeight: '300' },
  weekLabel: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  dayTabs: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 10 },
  dayTab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, gap: 2 },
  dayTabActive: { backgroundColor: '#111827' },
  dayTabLabel: { fontSize: 11, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase' },
  dayTabLabelActive: { color: '#d1d5db' },
  dayTabNum: { fontSize: 20, fontWeight: '700', color: '#374151' },
  dayTabNumActive: { color: '#fff' },
  dayTabNumToday: { color: '#111827' },
  dayTabBadge: { backgroundColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1 },
  dayTabBadgeActive: { backgroundColor: '#374151' },
  dayTabBadgeText: { fontSize: 10, fontWeight: '700', color: '#6b7280' },
  dayTabBadgeTextActive: { color: '#d1d5db' },
  sportFilterScroll: { flexGrow: 0, flexShrink: 0, marginBottom: 8 },
  sportFilter: { paddingHorizontal: 16, paddingVertical: 4, gap: 6 },
  sportPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  sportPillText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  sportPillTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  emptyText: { textAlign: 'center', color: '#9ca3af', paddingTop: 48, fontSize: 15 },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#f3f4f6', overflow: 'hidden', alignItems: 'center' },
  cardPast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#f3f4f6', opacity: 0.55 },
  cardAccentThin: { width: 3, height: 16, borderRadius: 2, flexShrink: 0 },
  cardPastTime: { fontSize: 12, fontWeight: '600', color: '#6b7280', width: 38 },
  cardPastName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#374151' },
  cardPastMeta: { fontSize: 11, color: '#9ca3af', flexShrink: 1 },
  cardPressed: { backgroundColor: '#f9fafb' },
  cardAccent: { width: 4, alignSelf: 'stretch' },
  cardBody: { flex: 1, padding: 14, gap: 8 },
  cardRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  cardTime: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardDuration: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  cardMain: { flex: 1, gap: 3 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  cardMeta: { fontSize: 12, color: '#9ca3af' },
  cardTags: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  sportTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  sportTagText: { fontSize: 10, fontWeight: '600' },
  cardCredits: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },
  cardSpots: { fontSize: 11, color: '#9ca3af' },
  cardSpotsFull: { color: '#ef4444' },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusBooked: { backgroundColor: '#d1fae5' },
  statusWaitlist: { backgroundColor: '#fef3c7' },
  statusText: { fontSize: 12, fontWeight: '600' },
  statusTextBooked: { color: '#065f46' },
  statusTextWaitlist: { color: '#92400e' },
  chevron: { fontSize: 20, color: '#d1d5db', paddingRight: 14 },
})
