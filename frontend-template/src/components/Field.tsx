import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  /** Adds a Show/Hide toggle. */
  password?: boolean;
}

export function Field({ label, error, password, ...input }: Props) {
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View
        style={[
          styles.box,
          { backgroundColor: colors.card, borderColor: error ? colors.danger : focused ? colors.primary : colors.border },
        ]}
      >
        <TextInput
          {...input}
          secureTextEntry={password ? hidden : input.secureTextEntry}
          placeholderTextColor={colors.faint}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, { color: colors.ink }]}
        />
        {password ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  box: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: radius.input, borderWidth: 1, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, height: '100%' },
  error: { fontSize: 13, marginTop: 6 },
});
