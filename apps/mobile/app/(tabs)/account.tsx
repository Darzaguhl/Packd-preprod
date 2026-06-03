import { useCallback, useState } from 'react'
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  SafeAreaView, StyleSheet, Alert, RefreshControl,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useAuthReady } from '@/lib/useAuthReady'
import type { MemberProfile } from '@packd/types'

export default function AccountScreen() {
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  async function loadProfile(silent = false) {
    if (!silent) setLoadError(false)
    try {
      const data = await api.members.me()
      setProfile(data)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useFocusEffect(useCallback(() => { loadProfile() }, []))
  useAuthReady(() => loadProfile())

  async function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ])
  }

  if (loading) return (
    <SafeAreaView style={styles.safe}>
      <ActivityIndicator style={{ flex: 1 }} color="#111827" />
    </SafeAreaView>
  )
  if (loadError || !profile) return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Text style={{ fontSize: 15, color: '#6b7280' }}>Could not load profile</Text>
        <Pressable onPress={loadProfile} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#111827', borderRadius: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )

  const sub = profile.activeSubscription
  const initials = [profile.firstName?.[0], profile.lastName?.[0]].filter(Boolean).join('').toUpperCase()

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadProfile(true) }} tintColor="#111827" />}
      >
        <Text style={styles.title}>Account</Text>

        {/* Avatar + name */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || '?'}</Text>
          </View>
          <View>
            <Text style={styles.name}>{profile.firstName} {profile.lastName}</Text>
            <Text style={styles.email}>{profile.email}</Text>
          </View>
        </View>

        {/* Credits */}
        <View style={styles.creditsCard}>
          <Text style={styles.creditsLabel}>Credit balance</Text>
          <Text style={styles.creditsValue}>{profile.creditBalance}</Text>
          <Text style={styles.creditsUnit}>credits</Text>
        </View>

        {/* Membership */}
        {sub ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Membership</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Plan</Text>
                <Text style={styles.cardValue}>{sub.planName}</Text>
              </View>
              <View style={[styles.cardRow, styles.cardRowBorder]}>
                <Text style={styles.cardLabel}>Status</Text>
                <View style={[styles.statusBadge, statusBadgeStyle(sub.status)]}>
                  <Text style={[styles.statusText, statusTextStyle(sub.status)]}>
                    {sub.status.charAt(0) + sub.status.slice(1).toLowerCase()}
                  </Text>
                </View>
              </View>
              {sub.nextBillingDate && (
                <View style={[styles.cardRow, styles.cardRowBorder]}>
                  <Text style={styles.cardLabel}>Next billing</Text>
                  <Text style={styles.cardValue}>
                    {new Date(sub.nextBillingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Membership</Text>
            <View style={styles.card}>
              <Text style={styles.noSubText}>No active membership. Visit the web app to sign up for a plan.</Text>
            </View>
          </View>
        )}

        {/* Sign out */}
        <Pressable onPress={handleSignOut} style={({ pressed }) => [styles.signOutBtn, pressed && styles.signOutBtnPressed]}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function statusBadgeStyle(status: string) {
  if (status === 'ACTIVE') return { backgroundColor: '#d1fae5' }
  if (status === 'PAUSED') return { backgroundColor: '#fef3c7' }
  if (status === 'PAST_DUE') return { backgroundColor: '#fee2e2' }
  return { backgroundColor: '#f3f4f6' }
}

function statusTextStyle(status: string) {
  if (status === 'ACTIVE') return { color: '#065f46' }
  if (status === 'PAUSED') return { color: '#92400e' }
  if (status === 'PAST_DUE') return { color: '#991b1b' }
  return { color: '#374151' }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#f9fafb', borderRadius: 16, padding: 16 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  name: { fontSize: 17, fontWeight: '700', color: '#111827' },
  email: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  creditsCard: { backgroundColor: '#111827', borderRadius: 16, padding: 20, alignItems: 'flex-start', gap: 2 },
  creditsLabel: { fontSize: 12, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  creditsValue: { fontSize: 44, fontWeight: '800', color: '#fff', lineHeight: 50 },
  creditsUnit: { fontSize: 14, color: '#6b7280' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#f3f4f6', overflow: 'hidden' },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  cardRowBorder: { borderTopWidth: 1, borderTopColor: '#f9fafb' },
  cardLabel: { fontSize: 14, color: '#6b7280' },
  cardValue: { fontSize: 14, fontWeight: '600', color: '#111827' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '600' },
  noSubText: { fontSize: 13, color: '#9ca3af', padding: 14, lineHeight: 20 },
  signOutBtn: { borderRadius: 14, borderWidth: 1, borderColor: '#f3f4f6', padding: 16, alignItems: 'center', marginTop: 4 },
  signOutBtnPressed: { backgroundColor: '#f9fafb' },
  signOutText: { fontSize: 15, color: '#ef4444', fontWeight: '600' },
})
