import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  SafeAreaView, StyleSheet, Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, type SessionSpots, type StationType } from '@/lib/api'
import { sportColor } from '@/lib/constants'
import SpotPicker from '@/components/SpotPicker'
import WaiverModal from '@/components/WaiverModal'

export default function SessionDetailScreen() {
  const router = useRouter()
  const p = useLocalSearchParams<{
    id: string
    roomId: string
    studioId: string
    templateName: string
    sport: string
    startsAt: string
    endsAt: string
    instructorName: string
    roomName: string
    creditsRequired: string
    capacity: string
    bookedCount: string
    userBookingId: string
    userStationId: string
    userWaitlistPosition: string
  }>()

  const creditsRequired = Number(p.creditsRequired ?? 0)
  const capacity = Number(p.capacity ?? 0)
  const initialBookedCount = Number(p.bookedCount ?? 0)

  // Live state
  const [bookedCount, setBookedCount] = useState(initialBookedCount)
  const [myBookingId, setMyBookingId] = useState(p.userBookingId || null)
  const [myStationId, setMyStationId] = useState(p.userStationId || null)
  const [waitlistPos, setWaitlistPos] = useState(p.userWaitlistPosition ? Number(p.userWaitlistPosition) : null)

  // Room map
  const [spots, setSpots] = useState<SessionSpots | null>(null)
  const [spotsLoading, setSpotsLoading] = useState(true)
  const [pendingStationId, setPendingStationId] = useState<string | null>(null)

  // Waiver
  const [waiver, setWaiver] = useState<{ id: string; title: string; body: string } | null>(null)
  const [showWaiver, setShowWaiver] = useState(false)

  // Action loading
  const [actionLoading, setActionLoading] = useState(false)

  const isFull = bookedCount >= capacity
  const isBooked = !!myBookingId
  const isWaitlisted = !!waitlistPos
  const hasLayout = !!spots?.layout

  useEffect(() => {
    if (!p.roomId) { setSpotsLoading(false); return }
    api.rooms.spots(p.roomId, p.id)
      .then(data => {
        setSpots(data)
        // Use server-authoritative booking/station IDs — URL params may be stale on cold start
        if (data.myBookingId) setMyBookingId(data.myBookingId)
        if (data.myStationId) setMyStationId(data.myStationId)
      })
      .catch(() => {
        // Map unavailable — booking actions still work, just no spot picker
        setSpots(null)
      })
      .finally(() => setSpotsLoading(false))
  }, [p.id, p.roomId])

  async function handleBook() {
    if (hasLayout && !pendingStationId && !myBookingId) {
      Alert.alert('Pick a spot', 'Tap a spot on the map to reserve your place.')
      return
    }

    setActionLoading(true)
    try {
      // Waiver check — only on first booking attempt
      if (!myBookingId) {
        let bookingId: string
        try {
          const res = await api.bookings.create(p.id)
          if (!res.success || !res.data?.id) throw new Error('Booking failed')
          bookingId = res.data.id
        } catch (e) {
          const err = e as Error & { error?: string; waiverId?: string }
          if (err.message === 'WAIVER_REQUIRED' && err.waiverId && p.studioId) {
            const wRes = await api.waivers.getActive(p.studioId)
            if (wRes.waiver) {
              setWaiver(wRes.waiver)
              setShowWaiver(true)
            }
            return
          }
          throw e
        }

        setMyBookingId(bookingId)
        setBookedCount(c => c + 1)

        // Assign spot if selected
        if (pendingStationId && p.roomId) {
          try {
            await api.rooms.assignSpot(p.roomId, p.id, pendingStationId)
            setMyStationId(pendingStationId)
          } catch {
            // Booking succeeded but spot assignment failed — let user know to pick again
            Alert.alert('Booked!', 'Your class is confirmed but your spot selection could not be saved. Tap a spot on the map to try again.')
          }
        }

        // Refresh spots
        if (p.roomId) {
          api.rooms.spots(p.roomId, p.id).then(setSpots).catch(() => {})
        }
      } else if (pendingStationId && myBookingId !== pendingStationId) {
        // Already booked — just reassign spot
        if (p.roomId) {
          await api.rooms.assignSpot(p.roomId, p.id, pendingStationId)
          setMyStationId(pendingStationId)
          api.rooms.spots(p.roomId, p.id).then(setSpots).catch(() => {})
        }
      }
    } catch (e) {
      // Clear pending spot so it doesn't look assigned after a failed booking
      setPendingStationId(null)
      const msg = e instanceof Error ? e.message : 'Something went wrong'
      const isCredits = msg.toLowerCase().includes('credit')
      Alert.alert(
        isCredits ? 'Not enough credits' : 'Booking failed',
        isCredits
          ? `This class requires ${creditsRequired} credit${creditsRequired !== 1 ? 's' : ''}. Top up your balance to book.`
          : msg,
      )
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSignWaiver() {
    if (!waiver) return
    try {
      await api.waivers.sign(waiver.id)
    } catch (e) {
      // Sign failed — keep modal open, surface the error
      Alert.alert('Could not save waiver', e instanceof Error ? e.message : 'Please try again.')
      throw e
    }
    // Only close the modal after sign succeeds
    setShowWaiver(false)
    setWaiver(null)
    // Retry the booking after signing
    try {
      await handleBook()
    } catch (e) {
      Alert.alert('Booking failed', e instanceof Error ? e.message : 'Please try again.')
    }
  }

  async function handleCancel() {
    if (!myBookingId) return
    Alert.alert(
      'Cancel booking?',
      undefined,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true)
            try {
              const res = await api.bookings.cancel(myBookingId)
              if (res.isLateCancel) {
                Alert.alert('Cancelled', 'A late cancellation fee has been applied.')
              }
              setMyBookingId(null)
              setMyStationId(null)
              setPendingStationId(null)
              setBookedCount(c => Math.max(0, c - 1))
              if (p.roomId) api.rooms.spots(p.roomId, p.id).then(setSpots).catch(() => {})
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not cancel')
            } finally {
              setActionLoading(false)
            }
          },
        },
      ],
    )
  }

  async function handleWaitlist() {
    setActionLoading(true)
    try {
      if (isWaitlisted) {
        await api.waitlist.leave(p.id)
        setWaitlistPos(null)
      } else {
        const res = await api.waitlist.join(p.id)
        setWaitlistPos(res.success ? (res.data?.position ?? 1) : 1)
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setActionLoading(false)
    }
  }

  const startsAt = new Date(p.startsAt)
  const endsAt = new Date(p.endsAt)
  const durationMin = Math.round((endsAt.getTime() - startsAt.getTime()) / 60000)
  const startTime = startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  const endTime = endsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  const dateLabel = startsAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const accentColor = sportColor(p.sport ?? '')
  const spotsLeft = capacity - bookedCount

  // The effective station for the spot picker (pending selection or already confirmed)
  const displayStationId = pendingStationId ?? myStationId

  // Short label helper: BIKE→B, TREADMILL→T, ROWER→R, BENCH→BN, MAT→M, REFORMER→RF, BARRE→BR
  function shortLabel(station: { type: StationType; label: string }): string {
    const prefix: Record<StationType, string> = {
      BIKE: 'B', TREADMILL: 'T', ROWER: 'R', BENCH: 'BN',
      MAT: 'M', REFORMER: 'RF', BARRE: 'BR', OTHER: '',
    }
    const p = prefix[station.type]
    // If label is already numeric or has the prefix, use it; otherwise prepend
    const num = station.label.replace(/^\D+/, '')
    return num ? `${p}${num}` : station.label
  }

  // Button logic
  let primaryLabel = ''
  let primaryAction = () => {}
  let primaryStyle = styles.btnPrimary
  let primaryDisabled = actionLoading

  if (spotsLoading) {
    // Map still loading — show disabled placeholder
    primaryLabel = 'Book a spot'
    primaryStyle = styles.btnDisabledPrimary
    primaryDisabled = true
  } else if (isBooked) {
    primaryLabel = 'Cancel booking'
    primaryAction = handleCancel
    primaryStyle = styles.btnCancel
  } else if (isFull && !isWaitlisted) {
    primaryLabel = 'Join waitlist'
    primaryAction = handleWaitlist
    primaryStyle = styles.btnWaitlist
  } else if (isWaitlisted) {
    primaryLabel = 'Leave waitlist'
    primaryAction = handleWaitlist
    primaryStyle = styles.btnWaitlist
  } else if (hasLayout && !pendingStationId) {
    primaryLabel = 'Book a spot'
    primaryAction = handleBook
    primaryStyle = styles.btnDisabledPrimary
    primaryDisabled = true
  } else if (hasLayout && pendingStationId) {
    const station = spots?.layout?.stations.find(s => s.id === pendingStationId)
    const label = station ? shortLabel(station) : pendingStationId
    primaryLabel = `Book ${label}`
    primaryAction = handleBook
  } else {
    primaryLabel = 'Book class'
    primaryAction = handleBook
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Class info */}
        <View style={styles.infoCard}>
          <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
          <View style={styles.infoBody}>
            <View style={styles.infoRow}>
              <View>
                <Text style={styles.className}>{p.templateName}</Text>
                <Text style={styles.instructorName}>{p.instructorName}</Text>
                <Text style={styles.roomName}>{p.roomName}</Text>
              </View>
              <View style={[styles.sportBadge, { backgroundColor: accentColor + '22', borderColor: accentColor + '55' }]}>
                <Text style={[styles.sportBadgeText, { color: accentColor }]}>
                  {(p.sport ?? '').charAt(0).toUpperCase() + (p.sport ?? '').slice(1).toLowerCase()}
                </Text>
              </View>
            </View>
            <View style={styles.infoMeta}>
              <Text style={styles.infoMetaText}>{dateLabel}</Text>
              <Text style={styles.infoMetaText}>{startTime} – {endTime} · {durationMin} min</Text>
            </View>
            <View style={styles.infoStats}>
              <View style={styles.infoStat}>
                <Text style={styles.infoStatValue}>{creditsRequired}</Text>
                <Text style={styles.infoStatLabel}>credits</Text>
              </View>
              <View style={styles.infoStatDivider} />
              <View style={styles.infoStat}>
                <Text style={[styles.infoStatValue, isFull && styles.infoStatValueFull]}>{spotsLeft}</Text>
                <Text style={styles.infoStatLabel}>spots left</Text>
              </View>
              <View style={styles.infoStatDivider} />
              <View style={styles.infoStat}>
                <Text style={styles.infoStatValue}>{capacity}</Text>
                <Text style={styles.infoStatLabel}>capacity</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Status badges */}
        {isBooked && (
          <View style={styles.bookedBadge}>
            <Text style={styles.bookedBadgeText}>✓ You're booked</Text>
          </View>
        )}
        {isWaitlisted && (
          <View style={styles.waitlistBadge}>
            <Text style={styles.waitlistBadgeText}>#{waitlistPos} on the waitlist</Text>
          </View>
        )}

        {/* Room map */}
        {spotsLoading ? (
          <ActivityIndicator style={styles.spotsLoader} color="#9ca3af" />
        ) : hasLayout ? (
          <View style={styles.mapSection}>
            <Text style={styles.mapTitle}>
              {isBooked && myStationId
                ? 'Your spot — tap to move'
                : isBooked
                ? 'Pick a spot'
                : 'Select a spot to book'}
            </Text>
            <SpotPicker
              layout={spots!.layout!}
              assignments={spots!.assignments}
              myStationId={displayStationId}
              onPick={stationId => {
                if (isBooked && myBookingId && p.roomId) {
                  // Already booked — assign immediately
                  if (stationId === myStationId) {
                    // Tap own spot: clear
                    api.rooms.assignSpot(p.roomId, p.id, null).then(() => {
                      setMyStationId(null)
                      setPendingStationId(null)
                      api.rooms.spots(p.roomId, p.id).then(setSpots).catch(() => {})
                    }).catch((e: Error) => Alert.alert('Error', e.message || 'Could not clear spot'))
                  } else {
                    api.rooms.assignSpot(p.roomId, p.id, stationId).then(() => {
                      setMyStationId(stationId)
                      setPendingStationId(null)
                      api.rooms.spots(p.roomId, p.id).then(setSpots).catch(() => {})
                    }).catch((e: Error) => Alert.alert('Error', e.message === 'Station already taken' ? 'That spot was just taken — pick another.' : e.message || 'Could not assign spot'))
                  }
                } else {
                  // Not yet booked — set pending selection
                  setPendingStationId(prev => prev === stationId ? null : stationId)
                }
              }}
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Action button — fixed at bottom */}
      <View style={styles.footer}>
        {hasLayout && (
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: '#4f46e5', borderColor: '#4338ca' }]} />
              <Text style={styles.legendLabel}>Your spot</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: '#ecfdf5', borderColor: '#6ee7b7' }]} />
              <Text style={styles.legendLabel}>Available</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: '#f3f4f6', borderColor: '#d1d5db' }]} />
              <Text style={styles.legendLabel}>Taken</Text>
            </View>
          </View>
        )}
        <Pressable
          onPress={primaryDisabled ? undefined : primaryAction}
          disabled={primaryDisabled}
          style={({ pressed }) => [styles.btn, primaryStyle, (!primaryDisabled && pressed) && styles.btnPressed]}
        >
          {actionLoading
            ? <ActivityIndicator size="small" color={isBooked ? '#ef4444' : '#fff'} />
            : <Text style={[styles.btnText, isBooked && styles.btnTextCancel]}>{primaryLabel}</Text>
          }
        </Pressable>
      </View>

      {/* Waiver modal */}
      {showWaiver && waiver && (
        <WaiverModal
          title={waiver.title}
          body={waiver.body}
          onSign={handleSignWaiver}
          onClose={() => { setShowWaiver(false); setWaiver(null) }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backBtnText: { fontSize: 17, color: '#374151', fontWeight: '500' },
  scroll: { padding: 20, gap: 16, paddingBottom: 100 },
  infoCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#f3f4f6', overflow: 'hidden' },
  accentBar: { width: 5 },
  infoBody: { flex: 1, padding: 16, gap: 14 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  className: { fontSize: 20, fontWeight: '800', color: '#111827' },
  instructorName: { fontSize: 14, color: '#6b7280', marginTop: 3 },
  roomName: { fontSize: 13, color: '#9ca3af', marginTop: 1 },
  sportBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, alignSelf: 'flex-start' },
  sportBadgeText: { fontSize: 11, fontWeight: '700' },
  infoMeta: { gap: 2 },
  infoMetaText: { fontSize: 13, color: '#374151' },
  infoStats: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 10, padding: 12 },
  infoStat: { flex: 1, alignItems: 'center' },
  infoStatValue: { fontSize: 20, fontWeight: '800', color: '#111827' },
  infoStatValueFull: { color: '#ef4444' },
  infoStatLabel: { fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', fontWeight: '600', marginTop: 1 },
  infoStatDivider: { width: 1, height: 28, backgroundColor: '#e5e7eb' },
  bookedBadge: { backgroundColor: '#d1fae5', borderRadius: 12, padding: 12, alignItems: 'center' },
  bookedBadgeText: { fontSize: 14, fontWeight: '700', color: '#065f46' },
  waitlistBadge: { backgroundColor: '#fef3c7', borderRadius: 12, padding: 12, alignItems: 'center' },
  waitlistBadgeText: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  spotsLoader: { paddingVertical: 24 },
  mapSection: { gap: 10 },
  mapTitle: { fontSize: 14, fontWeight: '600', color: '#374151' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 36, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f3f4f6', gap: 12 },
  legend: { flexDirection: 'row', gap: 16, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1.5 },
  legendLabel: { fontSize: 11, color: '#6b7280' },
  btn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#111827' },
  btnCancel: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#fca5a5' },
  btnWaitlist: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#d1d5db' },
  btnDisabledPrimary: { backgroundColor: '#374151', opacity: 0.5 },
  btnPressed: { opacity: 0.75 },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnTextCancel: { color: '#ef4444' },
})
