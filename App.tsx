import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { nodeMap } from './src/engine/graph';
import { getRoutes } from './src/services/routeService';
import { Route } from './src/types/types';

const nodes = Array.from(nodeMap.values());

export default function App() {
  const [startId, setStartId] = useState<string | null>(null);
  const [endId, setEndId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleNodePress(nodeId: string) {
    if (!startId) {
      setStartId(nodeId);
    } else if (!endId && nodeId !== startId) {
      setEndId(nodeId);
    } else {
      // Reset and start over
      setStartId(nodeId);
      setEndId(null);
      setRoutes([]);
      setError(null);
    }
  }

  function handleFindRoute() {
    if (!startId || !endId) return;
    const result = getRoutes(startId, endId);
    if (result.success) {
      setRoutes(result.routes);
      setError(null);
    } else {
      setError(result.error.message);
      setRoutes([]);
    }
  }

  function getNodeLabel(id: string) {
    return nodeMap.get(id)?.label ?? id;
  }

  return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Tunnel Navigator</Text>

        {/* Node selection */}
        <ScrollView horizontal style={styles.nodeRow}>
          {nodes.map(node => (
              <TouchableOpacity
                  key={node.id}
                  style={[
                    styles.nodeChip,
                    startId === node.id && styles.chipStart,
                    endId === node.id && styles.chipEnd,
                  ]}
                  onPress={() => handleNodePress(node.id)}
              >
                <Text style={styles.chipText}>{node.label}</Text>
              </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Selection summary */}
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            From: {startId ? getNodeLabel(startId) : '—'}
          </Text>
          <Text style={styles.summaryText}>
            To: {endId ? getNodeLabel(endId) : '—'}
          </Text>
        </View>

        {/* Find Route button */}
        <TouchableOpacity
            style={[styles.button, (!startId || !endId) && styles.buttonDisabled]}
            onPress={handleFindRoute}
            disabled={!startId || !endId}
        >
          <Text style={styles.buttonText}>Find Route</Text>
        </TouchableOpacity>

        {/* Results */}
        <ScrollView style={styles.results}>
          {error && <Text style={styles.error}>{error}</Text>}
          {routes.map((route, i) => (
              <View key={i} style={styles.routeCard}>
                <Text style={styles.routeTitle}>
                  Route {i + 1} — {route.distance} step{route.distance !== 1 ? 's' : ''}
                </Text>
                <Text style={styles.routePath}>
                  {route.path.map(id => getNodeLabel(id)).join(' → ')}
                </Text>
              </View>
          ))}
        </ScrollView>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', padding: 16 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  nodeRow: { flexGrow: 0, marginBottom: 16 },
  nodeChip: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  chipStart: { borderColor: '#4ade80', backgroundColor: '#052e16' },
  chipEnd: { borderColor: '#f87171', backgroundColor: '#2d0a0a' },
  chipText: { color: '#ffffff', fontSize: 13 },
  summary: { marginBottom: 16 },
  summaryText: { color: '#aaaaaa', fontSize: 14, marginBottom: 4 },
  button: {
    backgroundColor: '#4ade80',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: { backgroundColor: '#1e1e1e' },
  buttonText: { color: '#000000', fontWeight: '700', fontSize: 16 },
  results: { flex: 1 },
  error: { color: '#f87171', marginBottom: 12 },
  routeCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  routeTitle: { color: '#4ade80', fontWeight: '600', marginBottom: 6 },
  routePath: { color: '#cccccc', fontSize: 13, lineHeight: 20 },
});