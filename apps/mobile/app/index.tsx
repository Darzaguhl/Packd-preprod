import { ActivityIndicator, View } from 'react-native'

// Root index — renders a brief loading spinner while _layout.tsx
// determines auth state and redirects to /(auth)/login or /(tabs)/schedule.
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
      <ActivityIndicator size="large" color="#111827" />
    </View>
  )
}
