import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, describeError } from '../src/api';
import { useAuth } from '../src/features/auth/AuthProvider';
import { useTheme } from '../src/theme/ThemeProvider';

type SettingsModal = 'profile' | 'about' | null;

function SectionTitle({ title }: { title: string }) {
  const { colors } = useTheme();

  return (
    <Text style={[styles.sectionTitle, { color: colors.muted }]}>
      {title.toUpperCase()}
    </Text>
  );
}

function Divider() {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: colors.border },
      ]}
    />
  );
}

type SettingRowProps = {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  danger?: boolean;
};

function SettingRow({
  icon,
  title,
  subtitle,
  onPress,
  trailing,
  danger = false,
}: SettingRowProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.settingRow,
        { opacity: pressed && onPress ? 0.72 : 1 },
      ]}
    >
      <View
        style={[
          styles.rowIcon,
          {
            backgroundColor: danger ? '#FCE8E8' : colors.primaryTint,
          },
        ]}
      >
        <Text style={{ fontSize: 19 }}>{icon}</Text>
      </View>

      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowTitle,
            { color: danger ? colors.danger : colors.ink },
          ]}
        >
          {title}
        </Text>

        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailing ?? (
        onPress ? (
          <Text style={[styles.rowArrow, { color: colors.faint }]}>›</Text>
        ) : null
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, mode } = useTheme();
  const { user, setUser, signOut } = useAuth();

  const [activeModal, setActiveModal] = useState<SettingsModal>(null);

  const [nameDraft, setNameDraft] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(true);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  const isDark = mode === 'dark';

  // Email is used as a stable local key because every account has an email.
  const accountKey = user?.email
    ? encodeURIComponent(user.email.toLowerCase())
    : null;

  const photoStorageKey = accountKey
    ? `dayleebit.profile-photo.${accountKey}`
    : null;

  const notificationStorageKey = accountKey
    ? `dayleebit.notifications.${accountKey}`
    : null;

  useEffect(() => {
    let mounted = true;

    async function loadPreferences() {
      setLoadingPhoto(true);
      setLoadingNotifications(true);

      try {
        if (photoStorageKey) {
          const savedPhoto = await AsyncStorage.getItem(photoStorageKey);

          if (mounted) {
            setPhotoUri(savedPhoto);
          }
        } else if (mounted) {
          setPhotoUri(null);
        }

        if (notificationStorageKey) {
          const savedNotifications = await AsyncStorage.getItem(
            notificationStorageKey,
          );

          if (mounted) {
            setNotificationsEnabled(
              savedNotifications === null
                ? true
                : savedNotifications === 'true',
            );
          }
        } else if (mounted) {
          setNotificationsEnabled(true);
        }
      } catch {
        // Keep default preferences if local storage is unavailable.
      } finally {
        if (mounted) {
          setLoadingPhoto(false);
          setLoadingNotifications(false);
        }
      }
    }

    void loadPreferences();

    return () => {
      mounted = false;
    };
  }, [photoStorageKey, notificationStorageKey]);

  if (!user) {
    return (
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.bg }]}
        edges={['top', 'bottom']}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.muted }]}>
            Loading settings…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentUser: NonNullable<typeof user> = user;
  const displayName = currentUser.name?.trim() || 'Dayleebit user';

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'U';

  function openProfileEditor() {
    setNameDraft(currentUser.name ?? '');
    setActiveModal('profile');
  }

  async function choosePhoto() {
    if (!photoStorageKey) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Photo access needed',
          'Allow photo library access to choose your profile picture.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets[0]?.uri) {
        return;
      }

      const selectedUri = result.assets[0].uri;

      await AsyncStorage.setItem(photoStorageKey, selectedUri);
      setPhotoUri(selectedUri);
    } catch {
      Alert.alert(
        'Unable to select photo',
        'Please try choosing your profile photo again.',
      );
    }
  }

  async function removePhoto() {
    if (!photoStorageKey) return;

    try {
      await AsyncStorage.removeItem(photoStorageKey);
      setPhotoUri(null);
    } catch {
      Alert.alert('Unable to remove photo', 'Please try again.');
    }
  }

  async function saveProfile() {
    const name = nameDraft.trim();

    if (!name) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }

    if (name.length > 100) {
      Alert.alert('Name too long', 'Please shorten your name.');
      return;
    }

    setSavingProfile(true);

    try {
      const updatedUser = await api.users.update({ name });

      setUser(updatedUser);
      setActiveModal(null);

      Alert.alert('Profile updated', 'Your name has been saved.');
    } catch (error) {
      Alert.alert('Could not save profile', describeError(error));
    } finally {
      setSavingProfile(false);
    }
  }

  async function changeAppearance(enabled: boolean) {
    setSavingTheme(true);

    try {
      // ThemeProvider derives its appearance from user.theme in app/_layout.tsx.
      const updatedUser = await api.users.update({
        theme: enabled ? 'DARK' : 'LIGHT',
      });

      setUser(updatedUser);
    } catch (error) {
      Alert.alert(
        'Could not change appearance',
        describeError(error),
      );
    } finally {
      setSavingTheme(false);
    }
  }

  async function changeNotificationPreference(enabled: boolean) {
    if (!notificationStorageKey) return;

    const previousValue = notificationsEnabled;

    setNotificationsEnabled(enabled);

    try {
      await AsyncStorage.setItem(
        notificationStorageKey,
        String(enabled),
      );
    } catch {
      setNotificationsEnabled(previousValue);

      Alert.alert(
        'Could not save preference',
        'Please try changing this setting again.',
      );
    }
  }

  function confirmLogout() {
    Alert.alert(
      'Log out',
      'Are you sure you want to log out of Dayleebit?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: () => {
            void signOut();
          },
        },
      ],
    );
  }

  function explainAccountDeletion() {
    Alert.alert(
      'Account deletion',
      'The current backend does not provide an account-deletion endpoint. Your account has not been deleted.',
    );
  }

  function explainRating() {
    Alert.alert(
      'Thank you!',
      'A store rating link can be added when Dayleebit is published.',
    );
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header: no settings icon */}
        <View style={styles.pageHeader}>
          <Pressable
            onPress={() => router.replace('/(tabs)')}
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
            style={[
              styles.backButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.backArrow, { color: colors.ink }]}>‹</Text>
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={[styles.pageTitle, { color: colors.ink }]}>
              Settings
            </Text>
            <Text style={[styles.pageSubtitle, { color: colors.muted }]}>
              Make Dayleebit yours
            </Text>
          </View>
        </View>

        {/* Account summary and photo picker */}
        <View
          style={[
            styles.profileCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.profileMain}>
            <Pressable
              onPress={() => void choosePhoto()}
              accessibilityRole="button"
              accessibilityLabel="Choose profile photo"
              style={styles.avatarPressable}
            >
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: colors.primaryTint },
                ]}
              >
                {loadingPhoto ? (
                  <ActivityIndicator color={colors.primary} />
                ) : photoUri ? (
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text
                    style={[styles.avatarText, { color: colors.primary }]}
                  >
                    {initials}
                  </Text>
                )}

                <View
                  style={[
                    styles.cameraBadge,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.card,
                    },
                  ]}
                >
                  <Text style={styles.cameraBadgeText}>＋</Text>
                </View>
              </View>
            </Pressable>

            <View style={styles.profileInfo}>
              <Text
                numberOfLines={1}
                style={[styles.profileName, { color: colors.ink }]}
              >
                {displayName}
              </Text>

              <Text
                numberOfLines={2}
                style={[styles.profileEmail, { color: colors.muted }]}
              >
                {currentUser.email}
              </Text>

              <Pressable
                onPress={() => void choosePhoto()}
                accessibilityRole="button"
                style={styles.photoLinkButton}
              >
                <Text style={[styles.photoLink, { color: colors.primary }]}>
                  {photoUri ? 'Change photo' : 'Add profile photo'}
                </Text>
              </Pressable>
            </View>
          </View>

          {photoUri ? (
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Remove profile photo?',
                  'This removes the photo saved on this device.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => void removePhoto(),
                    },
                  ],
                )
              }
              style={styles.removePhotoButton}
            >
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Remove photo
              </Text>
            </Pressable>
          ) : null}

          <View
            style={[
              styles.profileDivider,
              { backgroundColor: colors.border },
            ]}
          />

          {/* Exactly one Edit Profile action */}
          <Pressable
            onPress={openProfileEditor}
            accessibilityRole="button"
            style={styles.editProfileButton}
          >
            <Text style={{ fontSize: 17 }}>✎</Text>

            <Text style={[styles.editProfileText, { color: colors.primary }]}>
              Edit Profile
            </Text>

            <Text style={{ color: colors.primary, fontSize: 21 }}>›</Text>
          </Pressable>
        </View>

        <SectionTitle title="Preferences" />

        <View
          style={[
            styles.settingGroup,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <SettingRow
            icon="🔔"
            title="Notifications"
            subtitle="Notification preference for this device"
            trailing={
              loadingNotifications ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Switch
                  value={notificationsEnabled}
                  onValueChange={(value) =>
                    void changeNotificationPreference(value)
                  }
                  trackColor={{
                    false: colors.border,
                    true: colors.primary,
                  }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Toggle notification preference"
                />
              )
            }
          />

          <Divider />

          <SettingRow
            icon="🌙"
            title="Dark mode"
            subtitle={
              isDark
                ? 'Dark appearance enabled'
                : 'Light appearance enabled'
            }
            trailing={
              savingTheme ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Switch
                  value={isDark}
                  onValueChange={(value) => void changeAppearance(value)}
                  trackColor={{
                    false: colors.border,
                    true: colors.primary,
                  }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Toggle dark mode"
                />
              )
            }
          />
        </View>

        <SectionTitle title="App" />

        <View
          style={[
            styles.settingGroup,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <SettingRow
            icon="ℹ️"
            title="About Dayleebit"
            subtitle="Our story and app version"
            onPress={() => setActiveModal('about')}
          />

          <Divider />

          <SettingRow
            icon="⭐"
            title="Rate the app"
            subtitle="Share your feedback"
            onPress={explainRating}
          />
        </View>

        <SectionTitle title="Danger zone" />

        <View
          style={[
            styles.settingGroup,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <SettingRow
            icon="🗑️"
            title="Delete account"
            subtitle="Permanently remove your account"
            danger
            onPress={explainAccountDeletion}
          />
        </View>

        <Pressable
          onPress={confirmLogout}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.logoutButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Text style={styles.logoutIcon}>↪</Text>
          <Text style={[styles.logoutText, { color: colors.danger }]}>
            Log Out
          </Text>
        </Pressable>

        <View style={styles.footer}>
          <Text style={[styles.footerBrand, { color: colors.primary }]}>
            Dayleebit ✦
          </Text>
          <Text style={[styles.footerTagline, { color: colors.muted }]}>
            A Little Better Every Day.
          </Text>
          <Text style={[styles.footerVersion, { color: colors.faint }]}>
            Made for progress, not perfection
          </Text>
        </View>
      </ScrollView>

      {/* Edit Profile modal */}
      <Modal
        visible={activeModal === 'profile'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActiveModal(null)}
      >
        <SafeAreaView
          style={[styles.modalScreen, { backgroundColor: colors.bg }]}
          edges={['top', 'bottom']}
        >
          <View
            style={[
              styles.modalHeader,
              { borderBottomColor: colors.border },
            ]}
          >
            <Pressable
              onPress={() => setActiveModal(null)}
              style={styles.modalCancel}
            >
              <Text style={{ color: colors.primary }}>Cancel</Text>
            </Pressable>

            <Text style={[styles.modalTitle, { color: colors.ink }]}>
              Edit Profile
            </Text>

            <View style={{ width: 50 }} />
          </View>

          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalAvatarWrap}>
              <Pressable
                onPress={() => void choosePhoto()}
                accessibilityRole="button"
                style={[
                  styles.modalAvatar,
                  { backgroundColor: colors.primaryTint },
                ]}
              >
                {photoUri ? (
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.modalAvatarImage}
                  />
                ) : (
                  <Text
                    style={[
                      styles.modalAvatarText,
                      { color: colors.primary },
                    ]}
                  >
                    {initials}
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={() => void choosePhoto()}>
                <Text
                  style={[
                    styles.changePhotoText,
                    { color: colors.primary },
                  ]}
                >
                  Change profile photo
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.ink }]}>
              Full name
            </Text>

            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Enter your name"
              placeholderTextColor={colors.faint}
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={100}
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  color: colors.ink,
                  borderColor: colors.border,
                },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: colors.ink }]}>
              Email address
            </Text>

            <View
              style={[
                styles.readOnlyField,
                {
                  backgroundColor: colors.primaryTint,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={{ color: colors.muted, fontSize: 14 }}>
                {currentUser.email}
              </Text>
            </View>

            <Text style={[styles.helperText, { color: colors.muted }]}>
              Your email address cannot be changed here.
            </Text>

            <Pressable
              onPress={() => void saveProfile()}
              disabled={savingProfile}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: savingProfile ? 0.7 : 1,
                },
              ]}
            >
              {savingProfile ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Save Changes</Text>
              )}
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* About modal */}
      <Modal
        visible={activeModal === 'about'}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.overlay}>
          <View
            style={[
              styles.aboutCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Pressable
              onPress={() => setActiveModal(null)}
              hitSlop={12}
              style={styles.aboutClose}
            >
              <Text style={{ color: colors.muted, fontSize: 24 }}>×</Text>
            </Pressable>

            <View
              style={[
                styles.aboutLogo,
                { backgroundColor: colors.primaryTint },
              ]}
            >
              <Text style={{ fontSize: 32 }}>✦</Text>
            </View>

            <Text style={[styles.aboutTitle, { color: colors.ink }]}>
              Dayleebit
            </Text>

            <Text style={[styles.aboutTagline, { color: colors.primary }]}>
              A Little Better Every Day.
            </Text>

            <Text style={[styles.aboutDescription, { color: colors.muted }]}>
              Build meaningful habits, celebrate small wins, and make steady
              progress at your own pace. You do not need to be perfect; you
              just need to keep showing up.
            </Text>

            <Text style={[styles.aboutVersion, { color: colors.faint }]}>
              Version 1.0.0
            </Text>

            <Pressable
              onPress={() => setActiveModal(null)}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  marginTop: 22,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },

  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 31,
    lineHeight: 34,
    marginTop: -3,
  },
  pageTitle: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '900',
    letterSpacing: -0.7,
  },
  pageSubtitle: {
    fontSize: 13,
    marginTop: 3,
  },

  profileCard: {
    borderWidth: 1,
    borderRadius: 23,
    paddingHorizontal: 17,
    paddingTop: 19,
    paddingBottom: 3,
    marginBottom: 27,
  },
  profileMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  avatarPressable: {
    borderRadius: 35,
  },
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  avatarImage: {
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '900',
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  cameraBadgeText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 21,
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  profileEmail: {
    fontSize: 12,
    marginTop: 5,
  },
  photoLinkButton: {
    alignSelf: 'flex-start',
    paddingTop: 7,
  },
  photoLink: {
    fontSize: 12,
    fontWeight: '800',
  },
  removePhotoButton: {
    alignSelf: 'flex-end',
    paddingTop: 9,
  },
  profileDivider: {
    height: 1,
    marginTop: 17,
  },
  editProfileButton: {
    minHeight: 51,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  editProfileText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },

  sectionTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 11,
    marginLeft: 3,
  },
  settingGroup: {
    borderWidth: 1,
    borderRadius: 21,
    paddingHorizontal: 14,
    marginBottom: 27,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 75,
    paddingVertical: 12,
    gap: 12,
  },
  rowIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  rowSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  rowArrow: {
    fontSize: 25,
    marginLeft: 3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 55,
  },

  logoutButton: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: -5,
  },
  logoutIcon: {
    color: '#D9534F',
    fontSize: 22,
    fontWeight: '800',
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '900',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 30,
    gap: 5,
  },
  footerBrand: {
    fontSize: 17,
    fontWeight: '900',
  },
  footerTagline: {
    fontSize: 12,
  },
  footerVersion: {
    fontSize: 10,
    marginTop: 3,
  },

  modalScreen: {
    flex: 1,
  },
  modalHeader: {
    minHeight: 58,
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCancel: {
    minWidth: 50,
    paddingVertical: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  modalContent: {
    paddingHorizontal: 22,
    paddingTop: 25,
    paddingBottom: 40,
  },
  modalAvatarWrap: {
    alignItems: 'center',
    marginBottom: 30,
    gap: 10,
  },
  modalAvatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  modalAvatarImage: {
    width: '100%',
    height: '100%',
  },
  modalAvatarText: {
    fontSize: 30,
    fontWeight: '900',
  },
  changePhotoText: {
    fontSize: 13,
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 9,
    marginTop: 18,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 15,
    fontSize: 15,
  },
  readOnlyField: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 15,
    justifyContent: 'center',
  },
  helperText: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
  },
  primaryButton: {
    minHeight: 53,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginTop: 29,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },

  overlay: {
    flex: 1,
    padding: 24,
    backgroundColor: 'rgba(16, 16, 25, 0.48)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aboutCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 26,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  aboutClose: {
    alignSelf: 'flex-end',
    padding: 2,
  },
  aboutLogo: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  aboutTitle: {
    fontSize: 25,
    fontWeight: '900',
    marginTop: 17,
    letterSpacing: -0.6,
  },
  aboutTagline: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 5,
  },
  aboutDescription: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 18,
  },
  aboutVersion: {
    fontSize: 11,
    marginTop: 15,
  },
});