import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import GraphCanvas from './src/components/GraphCanvas';

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

const BOOT_STEPS = [
  'Loading campus graph',
  'Indexing routes',
  'Preparing gestures',
  'Finalizing map view',
] as const;
const BOOT_MIN_VISIBLE_MS = 900;
const BOOT_STEP_DELAY_MS = [140, 190, 220, 170] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toLogProgress(progress: number): number {
  return Math.log10(1 + progress * 9);
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
    };
  }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return {
      hasError: true,
      message,
    };
  }

  componentDidCatch(error: unknown): void {
    // Keeps stack trace in Metro/Expo logs for device-side debugging.
    console.error('AppErrorBoundary caught:', error);
  }

  reset = (): void => {
    this.setState({
      hasError: false,
      message: '',
    });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.errorScreen}>
        <Text style={styles.errorTitle}>App failed to render</Text>
        <Text selectable style={styles.errorMessage}>{this.state.message}</Text>
        <Pressable style={styles.errorButton} onPress={this.reset}>
          <Text style={styles.errorButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
}

function BootOverlay({ onHidden }: { onHidden: () => void }) {
  const [rawProgress, setRawProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const fillAnim = useRef(new Animated.Value(0)).current;
  const trackWidth = 232;

  const progressPercent = useMemo(() => Math.round(rawProgress * 100), [rawProgress]);
  const fillWidth = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, trackWidth],
  });

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      const start = Date.now();

      for (let index = 0; index < BOOT_STEPS.length; index += 1) {
        await delay(BOOT_STEP_DELAY_MS[index] ?? 160);
        if (cancelled) {
          return;
        }

        const nextProgress = (index + 1) / BOOT_STEPS.length;
        setStepIndex(index);
        setRawProgress(nextProgress);
      }

      const elapsed = Date.now() - start;
      if (elapsed < BOOT_MIN_VISIBLE_MS) {
        await delay(BOOT_MIN_VISIBLE_MS - elapsed);
      }
      if (cancelled) {
        return;
      }

      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) {
          onHidden();
        }
      });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [onHidden, overlayOpacity]);

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: toLogProgress(rawProgress),
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [fillAnim, rawProgress]);

  return (
    <Animated.View pointerEvents="auto" style={[styles.bootOverlay, { opacity: overlayOpacity }]}>
      <View style={styles.bootHaloOuter} />
      <View style={styles.bootHaloInner} />

      <View style={styles.bootCard}>
        <View style={styles.bootLogoBadge}>
          <MaterialCommunityIcons name="compass-rose" size={40} color="#87ccff" />
        </View>

        <Text style={styles.bootTitle}>Tunnel Navigator</Text>
        <Text style={styles.bootSubtitle}>{BOOT_STEPS[stepIndex] ?? BOOT_STEPS[BOOT_STEPS.length - 1]}</Text>

        <View style={[styles.bootProgressTrack, { width: trackWidth }]}>
          <Animated.View style={[styles.bootProgressFill, { width: fillWidth }]} />
        </View>

        <Text style={styles.bootPercentText}>{progressPercent}%</Text>
      </View>
    </Animated.View>
  );
}

export default function App() {
  const [bootVisible, setBootVisible] = useState(true);

  return (
    <AppErrorBoundary>
      <GraphCanvas />
      {bootVisible ? <BootOverlay onHidden={() => setBootVisible(false)} /> : null}
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    backgroundColor: '#0d121a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorTitle: {
    color: '#f5f7fb',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  errorMessage: {
    color: '#d9e2f2',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  errorButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: '#2a7af5',
  },
  errorButtonText: {
    color: '#f5f9ff',
    fontWeight: '700',
    fontSize: 13,
  },
  bootOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0d121a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootHaloOuter: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    borderWidth: 1,
    borderColor: 'rgba(85, 132, 185, 0.22)',
    backgroundColor: 'rgba(31, 57, 88, 0.18)',
  },
  bootHaloInner: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: 'rgba(119, 165, 221, 0.26)',
    backgroundColor: 'rgba(21, 36, 54, 0.5)',
  },
  bootCard: {
    width: 284,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2d4d75',
    backgroundColor: 'rgba(12, 21, 33, 0.94)',
    paddingHorizontal: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 10,
  },
  bootLogoBadge: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 1,
    borderColor: '#3d6ea4',
    backgroundColor: '#17324f',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  bootTitle: {
    color: '#e8f3ff',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  bootSubtitle: {
    marginTop: 6,
    color: '#9ab7d9',
    fontSize: 12,
    fontWeight: '600',
  },
  bootProgressTrack: {
    marginTop: 14,
    height: 8,
    borderRadius: 5,
    backgroundColor: '#1a2d45',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#365880',
  },
  bootProgressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#57a7ff',
  },
  bootPercentText: {
    marginTop: 8,
    color: '#d5e8ff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
