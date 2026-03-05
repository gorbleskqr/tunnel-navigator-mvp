import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import GraphCanvas from './src/components/GraphCanvas';

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
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

export default function App() {
  return (
    <AppErrorBoundary>
      <GraphCanvas />
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
});
