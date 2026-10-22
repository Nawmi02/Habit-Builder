
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const ONBOARDING_KEY = 'hb.onboardingSeen.v1';

const COLORS = {
  purple: '#7C3AED',
  purpleDark: '#5B35A5',
  purpleLight: '#EDE9FE',
  background: '#FFFFFF',
  heading: '#211B2D',
  text: '#6B7280',
  muted: '#9CA3AF',
  border: '#D1D5DB',
};

const slides = [
  {
    emoji: '🌱',
    title: 'Build habits that stick',
    subtitle:
      'Create simple routines and turn small actions into lasting change.',
    badge: 'Small steps, big changes',
  },
  {
    emoji: '📈',
    title: 'Track your progress',
    subtitle:
      'See your consistency grow and discover how much you accomplish every day.',
    badge: 'Progress you can see',
  },
  {
    emoji: '🔥',
    title: 'Become a better you',
    subtitle:
      'Build streaks, celebrate your wins, and become a little better every day.',
    badge: 'Every day counts',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [activeSlide, setActiveSlide] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const isLastSlide = activeSlide === slides.length - 1;

  useEffect(() => {
    let mounted = true;
    let splashTimer: ReturnType<typeof setTimeout> | undefined;

    async function initialize() {
      try {
        const alreadySeen = await AsyncStorage.getItem(ONBOARDING_KEY);

        if (!mounted) return;

        if (alreadySeen === '1') {
          router.replace('/login');
          return;
        }
      } catch (error) {
        console.warn('Could not read onboarding status:', error);
      }

      if (!mounted) return;

      setLoading(false);

      // Show the branded splash briefly before onboarding.
      splashTimer = setTimeout(() => {
        if (mounted) {
          setShowSplash(false);
        }
      }, 1600);
    }

    void initialize();

    return () => {
      mounted = false;

      if (splashTimer) {
        clearTimeout(splashTimer);
      }
    };
  }, [router]);

  async function markOnboardingSeen() {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch (error) {
      console.warn('Could not save onboarding status:', error);
    }
  }

  async function finishOnboarding() {
    await markOnboardingSeen();
    router.replace('/register');
  }

  async function skipOnboarding() {
    await markOnboardingSeen();
    router.replace('/login');
  }

  function goToSlide(index: number) {
    const nextIndex = Math.max(
      0,
      Math.min(slides.length - 1, index),
    );

    setActiveSlide(nextIndex);

    scrollRef.current?.scrollTo({
      x: nextIndex * width,
      animated: true,
    });
  }

  if (loading || showSplash) {
    return (
      <SafeAreaView
        style={styles.splash}
        edges={['top', 'bottom']}
      >
        <Image
          source={require('../../assets/images/dayleebit-logo.png')}
          style={[
            styles.launchLogo,
            {
              height: Math.min(width * 0.96, height * 0.48, 460),
            },
          ]}
          resizeMode="contain"
          accessibilityLabel="Dayleebit — A Little Better Every Day"
        />

        {loading && (
          <ActivityIndicator
            size="small"
            color={COLORS.purple}
            style={styles.loadingIndicator}
          />
        )}
      </SafeAreaView>
    );
  }

  const currentSlide = slides[activeSlide];

  return (
    <SafeAreaView
      style={styles.screen}
      edges={['top', 'bottom']}
    >
      {/* Illustration area */}
      <View style={styles.illustrationPanel}>
        <Pressable
          onPress={() => void skipOnboarding()}
          style={styles.skipButton}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onMomentumScrollEnd={(event) => {
            const index = Math.round(
              event.nativeEvent.contentOffset.x / width,
            );

            setActiveSlide(
              Math.max(0, Math.min(slides.length - 1, index)),
            );
          }}
        >
          {slides.map((slide, index) => (
            <View
              key={slide.title}
              style={[styles.illustrationSlide, { width }]}
            >
              <View style={styles.orbitOuter}>
                <View style={styles.orbitMiddle}>
                  <View style={styles.illustrationCard}>
                    <Text style={styles.illustrationEmoji}>
                      {slide.emoji}
                    </Text>
                  </View>
                </View>

                <View style={[styles.floatingBubble, styles.bubbleTop]}>
                  <Text style={styles.bubbleEmoji}>
                    {index === 0 ? '✨' : index === 1 ? '🎯' : '🏆'}
                  </Text>
                </View>

                <View
                  style={[styles.floatingBubble, styles.bubbleLeft]}
                >
                  <Text style={styles.bubbleEmoji}>
                    {index === 0 ? '💧' : index === 1 ? '✅' : '💜'}
                  </Text>
                </View>

                <View
                  style={[styles.floatingBubble, styles.bubbleRight]}
                >
                  <Text style={styles.bubbleEmoji}>
                    {index === 0 ? '🌿' : index === 1 ? '📅' : '⭐'}
                  </Text>
                </View>
              </View>

              <View style={styles.illustrationBadge}>
                <Text style={styles.illustrationBadgeText}>
                  {slide.badge}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Text and navigation */}
      <View style={styles.contentPanel}>
        <View style={styles.headingArea}>
          <Text style={styles.heading}>{currentSlide.title}</Text>

          <Text style={styles.subtitle}>
            {currentSlide.subtitle}
          </Text>
        </View>

        <View style={styles.bottomControls}>
          <View
            style={styles.pagination}
            accessibilityLabel={`Slide ${activeSlide + 1} of ${slides.length}`}
          >
            {slides.map((slide, index) => (
              <Pressable
                key={slide.title}
                onPress={() => goToSlide(index)}
                accessibilityRole="button"
                accessibilityLabel={`Go to slide ${index + 1}`}
                style={[
                  styles.paginationDot,
                  activeSlide === index
                    ? styles.activeDot
                    : styles.inactiveDot,
                ]}
              />
            ))}
          </View>

          <Pressable
            onPress={() =>
              isLastSlide
                ? void finishOnboarding()
                : goToSlide(activeSlide + 1)
            }
            style={styles.primaryButton}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>
              {isLastSlide ? 'Get started' : 'Next'}
            </Text>
            <Text style={styles.buttonArrow}>›</Text>
          </Pressable>

          <Pressable
            onPress={() => void skipOnboarding()}
            style={styles.signInButton}
            accessibilityRole="button"
          >
            <Text style={styles.signInText}>
              Already have an account?{' '}
              <Text style={styles.signInHighlight}>Sign in</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // The image already contains the brand name and motto.
  // Do not render another text label below it.
  launchLogo: {
    width: '96%',
    maxWidth: 460,
    alignSelf: 'center',
  },

  loadingIndicator: {
    position: 'absolute',
    bottom: 36,
  },

  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  illustrationPanel: {
    height: '48%',
    minHeight: 300,
    maxHeight: 460,
    backgroundColor: COLORS.purpleLight,
    position: 'relative',
    overflow: 'hidden',
  },

  skipButton: {
    position: 'absolute',
    zIndex: 5,
    top: 12,
    right: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },

  skipText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },

  illustrationSlide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 15,
  },

  orbitOuter: {
    width: 238,
    height: 238,
    borderRadius: 119,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  orbitMiddle: {
    width: 192,
    height: 192,
    borderRadius: 96,
    backgroundColor: 'rgba(255,255,255,0.48)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  illustrationCard: {
    width: 130,
    height: 130,
    borderRadius: 38,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purpleDark,
    shadowOpacity: 0.14,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },

  illustrationEmoji: {
    fontSize: 58,
  },

  floatingBubble: {
    position: 'absolute',
    width: 51,
    height: 51,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purpleDark,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },

  bubbleEmoji: {
    fontSize: 21,
  },

  bubbleTop: {
    top: 18,
    right: 23,
  },

  bubbleLeft: {
    top: 91,
    left: 13,
  },

  bubbleRight: {
    right: 17,
    bottom: 20,
  },

  illustrationBadge: {
    position: 'absolute',
    bottom: 3,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },

  illustrationBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.purpleDark,
  },

  contentPanel: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 12,
  },

  headingArea: {
    alignItems: 'center',
    paddingHorizontal: 3,
  },

  heading: {
    color: COLORS.heading,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: '900',
    letterSpacing: -0.7,
    textAlign: 'center',
  },

  subtitle: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 13,
    textAlign: 'center',
    maxWidth: 310,
  },

  bottomControls: {
    marginTop: 'auto',
  },

  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },

  paginationDot: {
    height: 8,
    borderRadius: 5,
  },

  activeDot: {
    width: 25,
    backgroundColor: COLORS.purple,
  },

  inactiveDot: {
    width: 8,
    backgroundColor: COLORS.border,
  },

  primaryButton: {
    height: 54,
    borderRadius: 28,
    backgroundColor: COLORS.purple,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  primaryButtonText: {
    color: COLORS.background,
    fontSize: 16,
    fontWeight: '800',
  },

  buttonArrow: {
    color: COLORS.background,
    fontSize: 25,
    lineHeight: 28,
    marginLeft: 9,
    marginTop: -2,
  },

  signInButton: {
    alignItems: 'center',
    paddingTop: 21,
    paddingBottom: 7,
  },

  signInText: {
    color: COLORS.text,
    fontSize: 13,
  },

  signInHighlight: {
    color: COLORS.purple,
    fontWeight: '800',
  },
});
