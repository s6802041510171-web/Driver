import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';

type Point = { latitude: number; longitude: number; speed?: number | null; timestamp: number };
type Tab = 'Home' | 'Trip' | 'Device' | 'Score';
type Motion = { x: number; y: number; z: number };

const forest = '#176B45';
const initialRegion: Region = { latitude: 13.7563, longitude: 100.5018, latitudeDelta: 0.045, longitudeDelta: 0.045 };
const emptyMotion: Motion = { x: 0, y: 0, z: 0 };

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}
function Metric({ title, value, unit, icon }: { title: string; value: string; unit: string; icon: string }) {
  return <Card style={styles.metric}><View style={styles.metricTop}><Text style={styles.metricIcon}>{icon}</Text><Text style={styles.metricValue}>{value}<Text style={styles.unit}> {unit}</Text></Text></View><Text style={styles.mutedSmall}>{title}</Text></Card>;
}
function MotionReadout({ title, unit, value, available }: { title: string; unit: string; value: Motion; available: boolean | null }) {
  return <Card><View style={styles.rowBetween}><Text style={styles.cardTitle}>{title}</Text><View style={styles.liveBadge}><View style={[styles.liveDot, available === false && { backgroundColor: '#D77D65' }]} /><Text style={styles.liveText}>{available === null ? 'Checking' : available ? 'LIVE' : 'Unavailable'}</Text></View></View><Text style={styles.mutedSmall}>{unit}</Text><View style={styles.axes}>{(['x', 'y', 'z'] as const).map((axis) => <View style={styles.axisBox} key={axis}><Text style={styles.axisName}>{axis.toUpperCase()}</Text><Text style={styles.axisValue}>{value[axis].toFixed(2)}</Text></View>)}</View></Card>;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Home');
  const [tripOn, setTripOn] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [accel, setAccel] = useState<Motion>(emptyMotion);
  const [gyro, setGyro] = useState<Motion>(emptyMotion);
  const [accelAvailable, setAccelAvailable] = useState<boolean | null>(null);
  const [gyroAvailable, setGyroAvailable] = useState<boolean | null>(null);
  const [harshEvents, setHarshEvents] = useState(0);
  const [turnEvents, setTurnEvents] = useState(0);
  const [savedTrips, setSavedTrips] = useState<{ distance: number; score: number; points: Point[] }[]>([]);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const accelSub = useRef<{ remove: () => void } | null>(null);
  const gyroSub = useRef<{ remove: () => void } | null>(null);
  const prevAccel = useRef<Motion | null>(null);
  const lastEvent = useRef(0);

  useEffect(() => {
    let mounted = true;
    Promise.all([Accelerometer.isAvailableAsync(), Gyroscope.isAvailableAsync()]).then(([a, g]) => {
      if (mounted) { setAccelAvailable(a); setGyroAvailable(g); }
    }).catch(() => { if (mounted) { setAccelAvailable(false); setGyroAvailable(false); } });
    return () => { mounted = false; locationSub.current?.remove(); accelSub.current?.remove(); gyroSub.current?.remove(); };
  }, []);

  const distanceKm = useMemo(() => {
    let meters = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const lat1 = a.latitude * Math.PI / 180, lat2 = b.latitude * Math.PI / 180;
      const dLat = lat2 - lat1, dLon = (b.longitude - a.longitude) * Math.PI / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      meters += 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    return meters / 1000;
  }, [points]);
  const currentSpeed = points.at(-1)?.speed;
  const speedKmh = currentSpeed != null && currentSpeed >= 0 ? Math.round(currentSpeed * 3.6) : 0;
  const score = Math.max(0, 100 - harshEvents * 5 - turnEvents * 3);
  const mapRegion: Region = points.length ? { latitude: points.at(-1)!.latitude, longitude: points.at(-1)!.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 } : initialRegion;

  async function startTrip() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Location Permission Required', 'Allow location access while using the app to record your route and speed.');
      return;
    }
    const services = await Location.hasServicesEnabledAsync();
    if (!services) { Alert.alert('Enable Location Services', 'Turn on location services on your phone and try again.'); return; }
    setPoints([]); setHarshEvents(0); setTurnEvents(0); prevAccel.current = null;
    setTripOn(true);
    try {
      locationSub.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 1500, distanceInterval: 3 }, (loc) => {
        setPoints((old) => [...old, { latitude: loc.coords.latitude, longitude: loc.coords.longitude, speed: loc.coords.speed, timestamp: loc.timestamp }]);
      });
    } catch { setTripOn(false); Alert.alert('Unable to Start Tracking', 'Check your location permission and try again.'); return; }
    Accelerometer.setUpdateInterval(250); Gyroscope.setUpdateInterval(250);
    accelSub.current = Accelerometer.addListener((v) => {
      setAccel(v);
      const prev = prevAccel.current; prevAccel.current = v;
      if (!tripOn && prev === null) return;
      const change = prev ? Math.sqrt((v.x - prev.x) ** 2 + (v.y - prev.y) ** 2 + (v.z - prev.z) ** 2) : 0;
      const now = Date.now();
      // Motion is an estimate: the phone's mounting direction affects which axis represents braking.
      if (change > 0.34 && now - lastEvent.current > 4500) { setHarshEvents((n) => n + 1); lastEvent.current = now; }
    });
    gyroSub.current = Gyroscope.addListener((v) => {
      setGyro(v);
      if (Math.abs(v.z) > 1.05 && Date.now() - lastEvent.current > 4500) { setTurnEvents((n) => n + 1); lastEvent.current = Date.now(); }
    });
  }
  function stopTrip() {
    locationSub.current?.remove(); locationSub.current = null;
    accelSub.current?.remove(); accelSub.current = null;
    gyroSub.current?.remove(); gyroSub.current = null;
    setTripOn(false);
    if (points.length) setSavedTrips((old) => [{ distance: distanceKm, score, points }, ...old]);
    Alert.alert('Trip Complete', `Distance: ${distanceKm.toFixed(1)} km · Score: ${score}/100`);
    setTab('Score');
  }


  const header = <View style={styles.header}><View style={styles.brandMark}><Text style={{ fontSize: 21 }}>♧</Text></View><View style={{ flex: 1 }}><Text style={styles.brandKicker}>GREEN DRIVER</Text><Text style={styles.brandName}>Eco‑Meter</Text></View><View style={styles.profile}><Text>🙂</Text></View></View>;
  const mapPanel = <View style={styles.mapWrap}><MapView style={styles.map} initialRegion={initialRegion} region={mapRegion} showsUserLocation showsMyLocationButton={false} followsUserLocation={tripOn}>
    {points.length > 0 && <><Polyline coordinates={points} strokeColor={forest} strokeWidth={5} /><Marker coordinate={points[0]} title="Start" pinColor="#176B45" />{points.length > 1 && <Marker coordinate={points[points.length - 1]} title="Latest Location" />}</>}
  </MapView><View style={styles.mapTag}><Text style={styles.mapTagText}>{tripOn ? '● Recording Location' : 'Trip Map'}</Text></View></View>;

  function Home() { return <>
    <View style={styles.greeting}><Label>GREEN DRIVER · TODAY</Label><Text style={styles.title}>Hello, Min 👋</Text><Text style={styles.subtitle}>Every good mile starts with mindful driving.</Text></View>
    <Card style={styles.scoreCard}><View style={styles.rowBetween}><Label>DRIVING SCORE</Label><Text style={styles.pillLight}>{tripOn ? '● LIVE' : '● READY TO DRIVE'}</Text></View><View style={styles.scoreLine}><View style={styles.scoreCircle}><Text style={styles.scoreNumber}>{tripOn ? score : savedTrips[0]?.score ?? '--'}</Text><Text style={styles.scoreOut}>/ 100</Text></View><View style={{ flex: 1 }}><Text style={styles.scoreMood}>{tripOn ? (score >= 85 ? 'Great driving 🌿' : 'Keep improving') : savedTrips.length ? 'View your latest trip score' : 'Start your first trip'}</Text><Text style={styles.scoreDesc}>Based on phone motion during your trip</Text></View></View><View style={styles.separator} /><View style={styles.rowBetween}><Text style={styles.scoreFoot}>Saved Trips</Text><Text style={styles.scoreFootStrong}>{savedTrips.length} trips</Text></View></Card>
    <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Trip Overview</Text><Text style={styles.mutedSmall}>{tripOn ? 'Live updates' : 'Start a trip to collect data'}</Text></View>
    <View style={styles.metricGrid}><Metric icon="↗" title="Current Speed" value={tripOn ? String(speedKmh) : '—'} unit="km/h" /><Metric icon="⌁" title="Trip Distance" value={tripOn ? distanceKm.toFixed(1) : '0.0'} unit="km" /><Metric icon="!" title="Harsh Events" value={String(harshEvents)} unit="events" /><Metric icon="⤴" title="Hard Turns" value={String(turnEvents)} unit="events" /></View>
    <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Location & Route</Text><Text style={styles.mutedSmall}>GPS</Text></View>{mapPanel}
    <Card style={styles.tipCard}><Text style={styles.tipIcon}>✦</Text><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Drive smoothly to save energy</Text><Text style={styles.mutedSmall}>Secure your phone and align it with the direction of travel for more meaningful sensor readings.</Text></View></Card>
  </>; }
  function TripScreen() { return <><View style={styles.greeting}><Label>TRIP MONITOR</Label><Text style={styles.title}>Trip</Text><Text style={styles.subtitle}>Track your location, speed, and phone motion.</Text></View>{mapPanel}<View style={styles.tripStats}><Metric icon="↗" title="Speed" value={String(speedKmh)} unit="km/h" /><Metric icon="⌁" title="Distance" value={distanceKm.toFixed(1)} unit="km" /></View><View style={styles.sectionHead}><Text style={styles.sectionTitle}>Sensor Status</Text></View><MotionReadout title="Accelerometer" unit="Acceleration · g (x / y / z axes)" value={accel} available={accelAvailable} /><MotionReadout title="Gyroscope" unit="Angular velocity · rad/s" value={gyro} available={gyroAvailable} /><Card style={styles.noteCard}><Text style={styles.noteText}>Braking and turning assessments depend on your phone's orientation and placement. Secure the phone before driving.</Text></Card></>; }
  function DeviceScreen() { return <><View style={styles.greeting}><Label>BLUETOOTH LE</Label><Text style={styles.title}>Vehicle Devices</Text><Text style={styles.subtitle}>BLE connectivity requires a native module.</Text></View><Card style={styles.deviceCard}><Text style={styles.bluetoothIcon}>ᛒ</Text><Text style={[styles.cardTitle, { marginTop: 10 }]}>BLE isn't available in Expo Go</Text><Text style={[styles.mutedSmall, { marginTop: 8 }]}>Expo Go does not include react-native-ble-plx, the native module used to scan for and connect to Bluetooth LE devices. Scanning and connecting are unavailable in this mode.</Text><Text style={[styles.mutedSmall, { marginTop: 12 }]}>Available in Expo Go: GPS, maps, Accelerometer, and Gyroscope.</Text><Text style={[styles.mutedSmall, { marginTop: 12 }]}>To connect to vehicle devices, use an Android development build instead of Expo Go.</Text></Card></>; }
  function ScoreScreen() { const latest = savedTrips[0]; return <><View style={styles.greeting}><Label>DRIVER SCORE</Label><Text style={styles.title}>Score Summary</Text><Text style={styles.subtitle}>Scores based on trip data recorded on this device.</Text></View><Card style={styles.bigScore}><Text style={styles.scoreNumberLarge}>{latest?.score ?? '--'}</Text><Text style={styles.bigScoreLabel}>Latest Score · out of 100</Text><View style={styles.separator} /><View style={styles.rowBetween}><Text style={styles.scoreFoot}>Saved Trips</Text><Text style={styles.scoreFootStrong}>{savedTrips.length}</Text></View></Card><View style={styles.sectionHead}><Text style={styles.sectionTitle}>Trip Statistics</Text></View><View style={styles.metricGrid}><Metric icon="!" title="Harsh Events" value={String(harshEvents)} unit="events" /><Metric icon="⤴" title="Hard Turns" value={String(turnEvents)} unit="events" /><Metric icon="↗" title="Average Speed" value={savedTrips.length ? String(Math.round(savedTrips[0].distance ? savedTrips[0].points.reduce((a,p)=>a+(p.speed ?? 0),0) / Math.max(1,savedTrips[0].points.length) * 3.6 : 0)) : '—'} unit="km/h" /><Metric icon="⌁" title="Latest Distance" value={latest ? latest.distance.toFixed(1) : '0.0'} unit="km" /></View><Card style={styles.noteCard}><Text style={styles.noteText}>This prototype score is based on motion events detected by the phone's sensors. It is not a standardized driving assessment and may vary depending on how the phone is mounted.</Text></Card><View style={styles.sectionHead}><Text style={styles.sectionTitle}>Previous Trips</Text></View>{savedTrips.length === 0 ? <Card><Text style={styles.mutedSmall}>Completed trips will appear here.</Text></Card> : savedTrips.map((trip, i) => <Card key={`${i}-${trip.distance}`} style={styles.deviceRow}><View><Text style={styles.cardTitle}>Trip {savedTrips.length - i}</Text><Text style={styles.mutedSmall}>{trip.distance.toFixed(1)} km</Text></View><Text style={styles.connectText}>{trip.score} points</Text></Card>)}</>; }

  return <SafeAreaView style={styles.safeArea}><StatusBar style="dark" />{header}<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    {tab === 'Home' && <Home />}{tab === 'Trip' && <TripScreen />}{tab === 'Device' && <DeviceScreen />}{tab === 'Score' && <ScoreScreen />}
  </ScrollView><View style={styles.bottomArea}>{tripOn ? <Pressable style={[styles.mainButton, styles.stopButton]} onPress={stopTrip}><Text style={styles.mainButtonText}>■  End Trip & View Score</Text></Pressable> : <Pressable style={styles.mainButton} onPress={startTrip}><Text style={styles.mainButtonText}>▶  Start Trip</Text></Pressable>}<View style={styles.tabBar}>{(['Home', 'Trip', 'Device', 'Score'] as Tab[]).map((item, i) => <Pressable style={styles.tabItem} key={item} onPress={() => setTab(item)}><Text style={[styles.tabIcon, tab === item && styles.tabActive]}>{['⌂', '↗', 'ᛒ', '☆'][i]}</Text><Text style={[styles.tabText, tab === item && styles.tabActive]}>{item}</Text></Pressable>)}</View></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F7F4' }, content: { paddingHorizontal: 18, paddingBottom: 20 }, header: { height: 62, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }, brandMark: { width: 40, height: 40, borderRadius: 14, backgroundColor: forest, alignItems: 'center', justifyContent: 'center' }, brandKicker: { fontSize: 9, fontWeight: '800', color: '#738078', letterSpacing: 1.5 }, brandName: { fontSize: 16, color: '#18221B', fontWeight: '800' }, profile: { width: 37, height: 37, borderRadius: 19, backgroundColor: '#E8ECE4', alignItems: 'center', justifyContent: 'center' }, greeting: { paddingTop: 10, paddingBottom: 18 }, eyebrow: { color: '#8A948C', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 }, title: { color: '#18221B', fontSize: 26, fontWeight: '800', letterSpacing: -0.6, marginTop: 5 }, subtitle: { color: '#778179', fontSize: 12, lineHeight: 18, marginTop: 4 }, card: { backgroundColor: '#FFFFFF', borderRadius: 19, borderWidth: 1, borderColor: '#EAEDE8', padding: 15, marginBottom: 11 }, scoreCard: { backgroundColor: '#173E2D', borderColor: '#173E2D', padding: 19, borderRadius: 24, marginBottom: 19 }, rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, pillLight: { backgroundColor: '#FFFFFF20', color: '#E6F1E9', overflow: 'hidden', borderRadius: 15, paddingVertical: 5, paddingHorizontal: 9, fontSize: 9, fontWeight: '700' }, scoreLine: { flexDirection: 'row', alignItems: 'center', gap: 15, marginVertical: 15 }, scoreCircle: { height: 94, width: 94, borderRadius: 48, borderWidth: 7, borderColor: '#C9ED76', alignItems: 'center', justifyContent: 'center' }, scoreNumber: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', lineHeight: 34 }, scoreOut: { color: '#BCD0C1', fontSize: 10 }, scoreMood: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' }, scoreDesc: { color: '#C4D4CA', fontSize: 10, lineHeight: 15, marginTop: 6 }, separator: { height: 1, backgroundColor: '#FFFFFF24', marginVertical: 12 }, scoreFoot: { color: '#CEDAD1', fontSize: 11 }, scoreFootStrong: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 }, sectionTitle: { color: '#1D2B22', fontSize: 15, fontWeight: '800' }, mutedSmall: { color: '#818B83', fontSize: 10, lineHeight: 16 }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, metric: { width: '48.3%', minHeight: 96, padding: 13 }, metricTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }, metricIcon: { color: forest, backgroundColor: '#EEF5E9', overflow: 'hidden', borderRadius: 10, width: 28, height: 28, textAlign: 'center', textAlignVertical: 'center', fontSize: 18, fontWeight: '700' }, metricValue: { fontSize: 19, color: '#1D2A22', fontWeight: '800' }, unit: { fontSize: 9, color: '#7C867E', fontWeight: '500' }, mapWrap: { height: 205, borderRadius: 20, overflow: 'hidden', marginBottom: 11, borderWidth: 1, borderColor: '#EAEDE8' }, map: { flex: 1 }, mapTag: { position: 'absolute', top: 11, left: 11, backgroundColor: '#FFFFFFE8', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 9 }, mapTagText: { color: '#45604B', fontSize: 10, fontWeight: '700' }, tipCard: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', backgroundColor: '#EAF2E4', borderColor: '#EAF2E4', marginTop: 7 }, tipIcon: { color: '#315833', fontSize: 20, width: 32, height: 32, borderRadius: 11, backgroundColor: '#C9ED76', textAlign: 'center', textAlignVertical: 'center' }, cardTitle: { color: '#26342A', fontSize: 12, fontWeight: '800' }, tripStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }, liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#54A96E' }, liveText: { fontSize: 9, color: '#647168', fontWeight: '700' }, axes: { flexDirection: 'row', gap: 7, marginTop: 13 }, axisBox: { flex: 1, backgroundColor: '#F4F7F2', paddingVertical: 10, paddingHorizontal: 9, borderRadius: 11, flexDirection: 'row', justifyContent: 'space-between' }, axisName: { color: forest, fontSize: 10, fontWeight: '800' }, axisValue: { color: '#24352A', fontSize: 12, fontVariant: ['tabular-nums'] }, noteCard: { backgroundColor: '#FFF8E9', borderColor: '#F6EAD0' }, noteText: { color: '#75694E', fontSize: 10, lineHeight: 16 }, deviceCard: { padding: 17 }, bluetoothIcon: { fontSize: 28, color: forest }, dataReadout: { backgroundColor: '#F4F7F2', borderRadius: 12, padding: 13, color: '#46544A', fontSize: 11, marginVertical: 14, minHeight: 43 }, action: { backgroundColor: forest, paddingVertical: 13, paddingHorizontal: 15, borderRadius: 13, alignItems: 'center', flex: 1 }, actionSecondary: { backgroundColor: '#EDF2EB' }, actionText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' }, actionTextSecondary: { color: forest }, buttonRow: { flexDirection: 'row', gap: 9 }, deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, connectText: { color: forest, fontSize: 10, fontWeight: '800' }, bigScore: { alignItems: 'center', backgroundColor: '#173E2D', borderColor: '#173E2D', paddingVertical: 23 }, scoreNumberLarge: { color: '#FFFFFF', fontSize: 60, fontWeight: '800' }, bigScoreLabel: { color: '#D3E1D7', fontSize: 11 }, bottomArea: { backgroundColor: '#F6F7F4', paddingTop: 7 }, mainButton: { height: 50, marginHorizontal: 17, marginBottom: 9, borderRadius: 16, backgroundColor: forest, alignItems: 'center', justifyContent: 'center' }, stopButton: { backgroundColor: '#B65F4E' }, mainButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, tabBar: { height: 62, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EAEDE8', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, tabItem: { alignItems: 'center', justifyContent: 'center', minWidth: 60, gap: 2 }, tabIcon: { fontSize: 19, color: '#9AA39C' }, tabText: { fontSize: 9, color: '#9AA39C', fontWeight: '600' }, tabActive: { color: forest, fontWeight: '800' },
});
