import React from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * STUB - Owner: Member 2. Prototype: AnalyticsScreen, WeeklyReport.
 * The backend has NO analytics endpoints. Compute from occurrence history with the tested
 * helpers in src/lib/analytics.ts (weeklyBars, heatmap, habitRates, overallRate), feeding them
 * GET /habits/{id}/occurrences/?from=&to= for each habit.
 */
export default function Analytics() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 20 }}>
      <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink }}>Analytics</Text>
      <Text style={{ color: colors.faint, marginTop: 12 }}>TODO (Member 2): build this screen from the prototype.</Text>
    </SafeAreaView>
  );
}
