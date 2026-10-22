import { Tabs } from 'expo-router';
import {
  Text,
  View,
  type ColorValue,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';

const tabIcon =
  (emoji: string) =>
  ({
    color,
    focused,
  }: {
    color: ColorValue;
    focused: boolean;
    size: number;
  }) => (
    <View
      style={{
        width: 42,
        height: 30,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused
          ? 'rgba(124, 58, 237, 0.10)'
          : 'transparent',
      }}
    >
      <Text
        style={{
          fontSize: 19,
          color,
          textAlign: 'center',
        }}
      >
        {emoji}
      </Text>
    </View>
  );

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,

        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          marginTop: -1,
          marginBottom: 2,
        },

        tabBarItemStyle: {
          paddingVertical: 0,
        },

        tabBarStyle: {
          height: 66 + insets.bottom,
          paddingTop: 7,
          paddingBottom: Math.max(insets.bottom, 4),
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          elevation: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: tabIcon('🏠'),
        }}
      />

      <Tabs.Screen
        name="habits"
        options={{
          title: 'Habits',
          tabBarIcon: tabIcon('✅'),
        }}
      />

      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: tabIcon('📈'),
        }}
      />

      <Tabs.Screen
        name="gamification"
        options={{
          title: 'Progress',
          tabBarIcon: tabIcon('🏆'),
        }}
      />
    </Tabs>
  );
}