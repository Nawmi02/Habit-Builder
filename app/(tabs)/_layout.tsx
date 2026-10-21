import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { useTheme } from '../../src/theme/ThemeProvider';

const icon = (emoji: string) => () => <Text style={{ fontSize: 20 }}>{emoji}</Text>;

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="habits" options={{ title: 'Habits', tabBarIcon: icon('✅') }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="gamification" options={{ title: 'Progress', tabBarIcon: icon('🏆') }} />
    </Tabs>
  );
}
