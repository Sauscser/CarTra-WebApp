import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import useSessionUser from '../../hooks/useSessionUser';
import ParentCreateForm from './ParentCreateForm';
import ParentLinkedLearners from './ParentLinkedLearners';
import { useIsFocused, useNavigation } from '@react-navigation/native';
// using TouchableOpacity for consistent ordering and styling

export default function ParentProfileScreen() {
  const [parentProfileId, setParentProfileId] = useState<string | null>(null);
  const [parentNationalId, setParentNationalId] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'create' | 'view'>('view');
  const isFocused = useIsFocused();
  const navigation = useNavigation();

  useEffect(() => {
    console.log('[DEBUG_PARENT_PROFILE_FOCUS] isFocused=', isFocused);
    if (isFocused) {
      setMode('view');
    }
  }, [isFocused]);

  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => {
      console.log('[DEBUG_PARENT_PROFILE_NAV_FOCUS] focus event');
      setMode('view');
    });
    return () => {
      try {
        if (!unsub) return;
        if (typeof unsub === 'function') {
          unsub();
          return;
        }
        const maybe = unsub as any;
        if (maybe && typeof maybe.remove === 'function') {
          maybe.remove();
        }
      } catch (e) {
        // ignore
      }
    };
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginVertical: 12 }}>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'view' ? styles.toggleBtnPrimary : styles.toggleBtnSecondary]}
          onPress={() => setMode('view')}
        >
          <Text style={mode === 'view' ? styles.toggleTextPrimary : styles.toggleTextSecondary}>View Children</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'create' ? styles.toggleBtnPrimary : styles.toggleBtnSecondary]}
          onPress={() => setMode('create')}
        >
          <Text style={mode === 'create' ? styles.toggleTextPrimary : styles.toggleTextSecondary}>Create Parent</Text>
        </TouchableOpacity>
      </View>

      {mode === 'create' && (
        <ParentCreateForm
          onProfileChanged={({ profileId, nationalId }) => {
            setParentProfileId(profileId);
            setParentNationalId(nationalId);
          }}
        />
      )}

      {mode === 'view' && (
        <ParentLinkedLearners key={String(isFocused)} parentProfileId={parentProfileId} parentNationalId={parentNationalId} parentTabFocused={isFocused} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, flexShrink: 0 },
  label: { fontWeight: '700', marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 8, borderRadius: 8, marginTop: 6 },
  saveButton: { marginTop: 12, backgroundColor: '#1d4ed8', padding: 12, borderRadius: 10 },
  saveText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  section: { marginTop: 18 },
  sectionTitle: { fontWeight: '800', marginBottom: 8 },
  learnerRow: { padding: 10, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 8 },
  learnerText: { fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { padding: 8, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#f8fafc' },
  toggleBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  toggleBtnPrimary: { backgroundColor: '#1d4ed8' },
  toggleBtnSecondary: { backgroundColor: '#eef2ff' },
  toggleTextPrimary: { color: '#fff', fontWeight: '700' },
  toggleTextSecondary: { color: '#1d4ed8', fontWeight: '700' },
});
