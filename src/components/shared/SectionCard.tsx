import React, { PropsWithChildren, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';

type SectionCardProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  fillAvailableHeight?: boolean;
}>;

export default function SectionCard({ title, subtitle, children, defaultExpanded = true, expanded, onToggle, fillAvailableHeight = false }: SectionCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = expanded !== undefined ? expanded : internalExpanded;

  useEffect(() => {
    if (expanded !== undefined) {
      setInternalExpanded(expanded);
    }
  }, [expanded]);

  const handleToggle = () => {
    const nextState = !isExpanded;
    if (expanded === undefined) {
      setInternalExpanded(nextState);
    }
    onToggle?.(nextState);
  };

  return (
    <View style={[styles.card, fillAvailableHeight && styles.fillCard]}>
      <TouchableOpacity activeOpacity={0.8} onPress={handleToggle} style={styles.header}>
        <View style={styles.headerText}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <Text style={styles.toggleText}>{isExpanded ? '−' : '+'}</Text>
      </TouchableOpacity>
      {isExpanded ? (
        <ScrollView
          nestedScrollEnabled
          style={fillAvailableHeight && styles.fillContent}
          contentContainerStyle={[styles.contentScroll, fillAvailableHeight && styles.fillContentContainer]}
        >
          {children}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: Platform.OS === 'web' ? 28 : 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#374151',
    marginBottom: 14,
  },
  toggleText: {
    fontSize: 32,
    lineHeight: 32,
    color: '#1d4ed8',
    fontWeight: '700',
    paddingLeft: 8,
  },
  contentScroll: {
    paddingBottom: 8,
  },
  fillCard: {
    flex: 1,
    minHeight: 0,
  },
  fillContent: {
    flex: 1,
  },
  fillContentContainer: {
    flexGrow: 1,
  },
});
