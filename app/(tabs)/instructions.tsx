import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

export default function InstructionsScreen() {
  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <ThemedText type="title" style={styles.title}>
          Cosmonav Voice Navigation
        </ThemedText>
        
        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Getting Started
          </ThemedText>
          <ThemedText style={styles.text}>
            1. Go to the Nav Prototype tab{'\n'}
            2. Press "Start Wake Word Listening"{'\n'}
            3. Say "Cosmo" to activate voice search
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Voice Commands
          </ThemedText>
          
          <ThemedText type="defaultSemiBold" style={styles.commandTitle}>
            Wake Word
          </ThemedText>
          <ThemedText style={styles.text}>
            • Say "Cosmo" to start voice search{'\n'}
            • The app will wait for your search query
          </ThemedText>

          <ThemedText type="defaultSemiBold" style={styles.commandTitle}>
            Searching for Places
          </ThemedText>
          <ThemedText style={styles.text}>
            • After saying "Cosmo", speak your destination{'\n'}
            • Example: "coffee shop", "gas station", "park"{'\n'}
            • The app will show the top 3 results
          </ThemedText>

          <ThemedText type="defaultSemiBold" style={styles.commandTitle}>
            Selecting a Result
          </ThemedText>
          <ThemedText style={styles.text}>
            • Say a number: "one", "two", "three", or "1", "2", "3"{'\n'}
            • Or tap on a result in the list{'\n'}
            • The app will calculate the route
          </ThemedText>

          <ThemedText type="defaultSemiBold" style={styles.commandTitle}>
            Starting Navigation
          </ThemedText>
          <ThemedText style={styles.text}>
            • Say "navigate", "start", or "begin"{'\n'}
            • Or press the "Start Navigation" button{'\n'}
            • Turn-by-turn directions will begin
          </ThemedText>

          <ThemedText type="defaultSemiBold" style={styles.commandTitle}>
            During Navigation
          </ThemedText>
          <ThemedText style={styles.text}>
            • Say "repeat", "again", or "what" to hear the current instruction{'\n'}
            • Say "stop", "cancel", or "end" to stop navigation{'\n'}
            • Wake word listening continues during navigation
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Search Tips
          </ThemedText>
          <ThemedText style={styles.text}>
            • Results are sorted by name relevance first, then distance{'\n'}
            • Exact name matches appear at the top{'\n'}
            • Partial matches come next{'\n'}
            • Other results are sorted by distance
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Features
          </ThemedText>
          <ThemedText style={styles.text}>
            ✓ Hands-free voice control{'\n'}
            ✓ Continuous wake word detection{'\n'}
            ✓ Real-time turn-by-turn navigation{'\n'}
            ✓ Off-route detection and recalculation{'\n'}
            ✓ Wrong-way alerts{'\n'}
            ✓ Smart search result ranking
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Troubleshooting
          </ThemedText>
          <ThemedText style={styles.text}>
            • Make sure microphone permissions are granted{'\n'}
            • Ensure location services are enabled{'\n'}
            • Speak clearly and wait for processing{'\n'}
            • Check your internet connection{'\n'}
            • If wake word stops working, restart listening
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <ThemedText style={styles.footerText}>
            Ready to navigate? Head to the Nav Prototype tab!
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    marginBottom: 24,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 12,
    color: '#007AFF',
  },
  commandTitle: {
    marginTop: 12,
    marginBottom: 6,
  },
  text: {
    lineHeight: 22,
    opacity: 0.9,
  },
  footer: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'center',
  },
  footerText: {
    textAlign: 'center',
    fontStyle: 'italic',
    opacity: 0.7,
  },
});
