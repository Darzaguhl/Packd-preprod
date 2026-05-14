import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { MemberProfile } from '@packd/types'

export default function AccountScreen() {
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.members.me().then(setProfile).finally(() => setLoading(false))
  }, [])

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Account</Text>
      {profile && (
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.name}>{profile.firstName} {profile.lastName}</Text>
            <Text style={styles.email}>{profile.email}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.label}>Credit Balance</Text>
            <Text style={styles.value}>{profile.creditBalance} credits</Text>
          </View>
          {profile.activeSubscription && (
            <View style={styles.card}>
              <Text style={styles.label}>Membership</Text>
              <Text style={styles.value}>{profile.activeSubscription.planName}</Text>
              <Text style={styles.meta}>{profile.activeSubscription.status}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', padding: 16 },
  content: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#f0f0f0' },
  name: { fontSize: 18, fontWeight: '700', color: '#111' },
  email: { fontSize: 13, color: '#888', marginTop: 2 },
  label: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 20, fontWeight: '700', color: '#111', marginTop: 4 },
  meta: { fontSize: 12, color: '#888', marginTop: 2 },
  signOutButton: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#f0f0f0', alignItems: 'center' },
  signOutText: { fontSize: 14, color: '#888' },
})
