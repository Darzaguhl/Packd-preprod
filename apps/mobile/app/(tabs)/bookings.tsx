import { useCallback, useState } from 'react'
import {
  View, Text, FlatList, Pressable, Alert, ActivityIndicator,
  SafeAreaView, StyleSheet, RefreshControl,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, type UpcomingBooking } from '@/lib/api'
import { sportColor } from '@/lib/constants'
import { useAuthReady } from '@/lib/useAuthReady'

export default function BookingsScreen() {
  const [bookings, setBookings] = useState<UpcomingBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true)
    setLoadError(false)
    try {
      const data = await api.bookings.upcoming()
      setBookings(data)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const router = useRouter()

  useFocusEffect(useCallback(() => { load() }, []))
  // Reload once auth is confirmed on cold start
  useAuthReady(() => load(false))

  async function handleCancel(booking: UpcomingBooking) {
    Alert.alert(
      'Cancel booking?',
      `${booking.templateName} on ${new Date(booking.startsAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`,
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: async () => {
            setCancelling(booking.id)
            try {
              const res = await api.bookings.cancel(booking.id)
              if (res.isLateCancel) {
                Alert.alert('Cancelled', 'A late cancellation fee has been applied.')
              }
              setBookings(prev => prev.filter(b => b.id !== booking.id))
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not cancel')
            } finally {
              setCancelling(null)
            }
          },
        },
      ],
    )
  }

  if (loading) return (
    <SafeAreaView style={styles.safe}>
      <ActivityIndicator style={{ flex: 1 }} color="#111827" />
    </SafeAreaView>
  )

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>My Classes</Text>
        <Text style={styles.subtitle}>{bookings.length} upcoming</Text>
      </View>

      <FlatList
        data={bookings}
        keyExtractor={b => b.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false) }} tintColor="#111827" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{loadError ? 'Could not load bookings' : 'No upcoming classes'}</Text>
            {loadError ? (
              <Text style={styles.emptyBody}>Pull down to retry.</Text>
            ) : (
              <Pressable onPress={() => router.replace('/(tabs)/schedule')}>
                <Text style={[styles.emptyBody, { color: '#4f46e5' }]}>Head to the Schedule tab to book a class →</Text>
              </Pressable>
            )}
          </View>
        }
        renderItem={({ item: b }) => {
          const d = new Date(b.startsAt)
          const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
          const durationMin = Math.round((new Date(b.endsAt).getTime() - d.getTime()) / 60000)
          const isCancelling = cancelling === b.id

          return (
            <View style={styles.card}>
              <View style={styles.cardDate}>
                <Text style={styles.cardDateDay}>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</Text>
                <Text style={styles.cardDateNum}>{d.getDate()}</Text>
                <Text style={styles.cardDateMonth}>{d.toLocaleDateString('en-GB', { month: 'short' })}</Text>
              </View>
              <View style={styles.cardDivider} />
              <View style={styles.cardBody}>
                <Text style={styles.cardName}>{b.templateName}</Text>
                <Text style={styles.cardMeta}>{time} · {durationMin}m · {b.instructorName}</Text>
                <Text style={styles.cardRoom}>{b.roomName}</Text>
                {b.stationLabel && (
                  <Text style={styles.cardSpot}>Spot: {b.stationLabel}</Text>
                )}
              </View>
              <Pressable
                onPress={() => handleCancel(b)}
                disabled={isCancelling}
                style={({ pressed }) => [styles.cancelBtn, (isCancelling || pressed) && styles.cancelBtnPressed]}
              >
                {isCancelling
                  ? <ActivityIndicator size="small" color="#ef4444" />
                  : <Text style={styles.cancelBtnText}>Cancel</Text>
                }
              </Pressable>
            </View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  list: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 64, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#374151' },
  emptyBody: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#f3f4f6', padding: 14, gap: 12 },
  cardDate: { alignItems: 'center', width: 44 },
  cardDateDay: { fontSize: 10, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase' },
  cardDateNum: { fontSize: 24, fontWeight: '800', color: '#111827', lineHeight: 28 },
  cardDateMonth: { fontSize: 10, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase' },
  cardDivider: { width: 1, height: 50, backgroundColor: '#f3f4f6' },
  cardBody: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  cardMeta: { fontSize: 12, color: '#6b7280' },
  cardRoom: { fontSize: 12, color: '#9ca3af' },
  cardSpot: { fontSize: 11, color: '#6b7280', marginTop: 2, fontWeight: '500' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5' },
  cancelBtnPressed: { backgroundColor: '#fef2f2' },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: '#ef4444' },
})
