import { StyleSheet, Text, View } from 'react-native'

export function NidDemoBanner({ message }: { message: string }): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  message: {
    color: '#B45309',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
})
