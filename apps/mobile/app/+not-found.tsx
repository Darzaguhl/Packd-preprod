import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'

export default function NotFound() {
  const router = useRouter()
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Page not found</Text>
      <Pressable onPress={() => router.replace('/(tabs)/schedule')} style={styles.btn}>
        <Text style={styles.btnText}>Go to schedule</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#fff' },
  title: { fontSize: 18, color: '#374151' },
  btn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#111827', borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600' },
})
