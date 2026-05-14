import { useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from 'react-native'
import { api } from '@/lib/api'
import type { SessionSlot } from '@packd/types'

const STUDIO_ID = process.env.EXPO_PUBLIC_STUDIO_ID!

export default function ScheduleScreen() {
  const [sessions, setSessions] = useState<SessionSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    const from = new Date().toISOString()
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    api.schedule.list(STUDIO_ID, from, to).then(setSessions).finally(() => setLoading(false))
  }, [])

  async function handleBook(session: SessionSlot) {
    if (session.userBookingId) {
      Alert.alert('Cancel class?', undefined, [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(session.id)
            try {
              const res = await api.bookings.cancel(session.userBookingId!)
              if (res.success && res.data.isLateCancel) {
                Alert.alert('Cancelled', 'A late cancel fee has been applied.')
              }
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === session.id
                    ? { ...s, bookedCount: s.bookedCount - 1, userBookingId: undefined }
                    : s,
                ),
              )
            } finally {
              setActionLoading(null)
            }
          },
        },
      ])
      return
    }

    setActionLoading(session.id)
    try {
      if (session.bookedCount >= session.capacity) {
        await api.waitlist.join(session.id)
        Alert.alert('Added to waitlist', "We'll notify you if a spot opens up.")
      } else {
        await api.bookings.create(session.id)
        setSessions((prev) =>
          prev.map((s) =>
            s.id === session.id
              ? { ...s, bookedCount: s.bookedCount + 1, userBookingId: 'booked' }
              : s,
          ),
        )
      }
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Schedule</Text>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item: s }) => {
          const isFull = s.bookedCount >= s.capacity
          const isBooked = !!s.userBookingId
          const isLoading = actionLoading === s.id

          return (
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                <Text style={styles.time}>
                  {new Date(s.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </Text>
                <Text style={styles.className}>{s.templateName}</Text>
                <Text style={styles.meta}>{s.instructorName} · {s.roomName}</Text>
                <Text style={styles.spots}>{s.capacity - s.bookedCount} spots · {s.creditsRequired} cr</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleBook(s)}
                disabled={isLoading}
                style={[
                  styles.button,
                  isBooked && styles.buttonCancel,
                  isFull && !isBooked && styles.buttonWaitlist,
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={isBooked ? '#ef4444' : '#fff'} />
                ) : (
                  <Text style={[styles.buttonText, isBooked && styles.buttonCancelText]}>
                    {isBooked ? 'Cancel' : isFull ? 'Waitlist' : 'Book'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', padding: 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#f0f0f0', marginBottom: 8,
  },
  cardLeft: { flex: 1 },
  time: { fontSize: 13, fontWeight: '600', color: '#111' },
  className: { fontSize: 15, fontWeight: '700', color: '#111', marginTop: 2 },
  meta: { fontSize: 12, color: '#888', marginTop: 2 },
  spots: { fontSize: 11, color: '#bbb', marginTop: 4 },
  button: {
    backgroundColor: '#000', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 8, minWidth: 70, alignItems: 'center',
  },
  buttonCancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#fca5a5' },
  buttonWaitlist: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  buttonCancelText: { color: '#ef4444' },
})
