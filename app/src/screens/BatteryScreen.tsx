import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isLow,
  levelLabel,
  needsInputMonitoring,
  nextThreshold,
  partsLabel,
  sourceLabel,
  THRESHOLD,
  timeAgo,
} from '../battery';
import { checkForUpdates, updateInfo, type UpdateInfo } from '../native/appUpdates';
import {
  type BatterySnapshot,
  type DeviceLevel,
  loadSnapshot,
  openInputMonitoringSettings,
  permissions,
  refreshBatteries,
  setThreshold,
} from '../native/juiceBattery';
import { colors, space } from '../theme';

/**
 * How often the window re-reads the published snapshot. The menu bar app does
 * the reading on its own schedule; this only picks up what it published.
 */
export const SNAPSHOT_POLL_MS = 15_000;

export function BatteryScreen(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BatterySnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMonitoring, setInputMonitoring] = useState(true);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [now, setNow] = useState(Date.now());

  const reload = useCallback(async () => {
    try {
      const [next, granted] = await Promise.all([loadSnapshot(), permissions()]);
      setSnapshot(previous => next ?? previous);
      setInputMonitoring(granted.inputMonitoring);
      setNow(Date.now());
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    reload();
    updateInfo().then(setUpdate, () => setUpdate(null));
    const timer = setInterval(reload, SNAPSHOT_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setSnapshot(await refreshBatteries());
      setNow(Date.now());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const changeThreshold = useCallback(
    async (direction: 1 | -1) => {
      if (snapshot === null) {
        return;
      }
      try {
        const next = await setThreshold(nextThreshold(snapshot.threshold, direction));
        if (next !== null) {
          setSnapshot(next);
        }
      } catch (cause) {
        setError(String(cause));
      }
    },
    [snapshot],
  );

  const devices = snapshot?.devices ?? [];
  const threshold = snapshot?.threshold ?? 20;
  const showPermission = !inputMonitoring || needsInputMonitoring(devices);

  return (
    <View style={styles.window}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Batteries</Text>
          <Text style={styles.caption}>
            {snapshot === null ? 'Reading your devices…' : `Updated ${timeAgo(snapshot.updatedAt, now)}`}
          </Text>
        </View>
        <Pressable testID="refresh" onPress={refresh} disabled={refreshing} style={styles.button}>
          <Text style={styles.buttonText}>{refreshing ? 'Reading…' : 'Refresh'}</Text>
        </Pressable>
      </View>

      {showPermission && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Some keyboards report their battery only to apps allowed Input Monitoring.
          </Text>
          <Pressable testID="input-monitoring" onPress={openInputMonitoringSettings} style={styles.button}>
            <Text style={styles.buttonText}>Open Settings</Text>
          </Pressable>
        </View>
      )}

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {snapshot !== null && devices.length === 0 && (
          <Text style={styles.caption}>No Bluetooth devices are connected.</Text>
        )}
        {devices.map(device => (
          <DeviceRow key={device.identifier} device={device} threshold={threshold} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.label}>Alert at</Text>
        <Pressable
          testID="threshold-down"
          onPress={() => changeThreshold(-1)}
          disabled={snapshot === null || threshold <= THRESHOLD.min}
          style={styles.stepper}>
          <Text style={styles.buttonText}>−</Text>
        </Pressable>
        <Text testID="threshold" style={[styles.label, styles.threshold]}>
          {threshold}%
        </Text>
        <Pressable
          testID="threshold-up"
          onPress={() => changeThreshold(1)}
          disabled={snapshot === null || threshold >= THRESHOLD.max}
          style={styles.stepper}>
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
        <View style={styles.spacer} />
        {update !== null && <Text style={styles.caption}>v{update.version}</Text>}
        {update?.canCheck === true && (
          <Pressable testID="check-updates" onPress={checkForUpdates} style={styles.button}>
            <Text style={styles.buttonText}>Check for Updates</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DeviceRow({ device, threshold }: { device: DeviceLevel; threshold: number }): React.JSX.Element {
  const low = isLow(device, threshold);
  const parts = partsLabel(device);
  return (
    <View style={styles.row} accessibilityLabel={`${device.name}, ${levelLabel(device)}${low ? ', low' : ''}`}>
      <View style={styles.rowText}>
        <Text style={styles.label} numberOfLines={1}>
          {device.name}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          {[parts, sourceLabel(device)].filter(Boolean).join(' — ')}
        </Text>
      </View>
      {device.percent !== null && (
        <View style={styles.track}>
          <View
            style={[styles.fill, { width: `${device.percent}%`, backgroundColor: low ? colors.low : colors.accent }]}
          />
        </View>
      )}
      <Text style={[styles.level, low && styles.low]}>{levelLabel(device)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: colors.window, padding: space.l, gap: space.m },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '600', color: colors.label },
  caption: { fontSize: 12, color: colors.secondaryLabel },
  label: { fontSize: 13, color: colors.label },
  error: { fontSize: 12, color: colors.low },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  bannerText: { flex: 1, fontSize: 12, color: colors.label },
  list: { flex: 1 },
  listContent: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.s,
    paddingHorizontal: space.m,
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  rowText: { flex: 1, gap: 2 },
  track: { width: 80, height: 6, borderRadius: 3, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  level: { width: 44, textAlign: 'right', fontSize: 13, color: colors.label, fontVariant: ['tabular-nums'] },
  low: { color: colors.low, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingTop: space.m,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  threshold: { width: 36, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stepper: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.track,
  },
  spacer: { flex: 1 },
  button: { paddingVertical: space.xs, paddingHorizontal: space.m, borderRadius: 6, backgroundColor: colors.track },
  buttonText: { fontSize: 13, color: colors.label },
});
