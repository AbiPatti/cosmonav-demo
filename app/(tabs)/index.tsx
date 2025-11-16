import { GoogleGenAI } from '@google/genai';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

// API keys from environment variables
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const SPEECH_API_KEY = process.env.EXPO_PUBLIC_SPEECH_TO_TEXT_API_KEY;
const GOOGLE_AI_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_AI_API_KEY;

if (!GOOGLE_AI_API_KEY) {
  throw new Error("Google AI API key is not set");
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_AI_API_KEY });

// Roboflow object detection API configuration
const INSTANCE_SEGMENTATION_API_URL = process.env.EXPO_PUBLIC_ROBOFLOW_API_URL;
const INSTANCE_SEGMENTATION_API_KEY = process.env.EXPO_PUBLIC_ROBOFLOW_API_KEY;

interface DetectedObject {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  color?: string;
}

// Generate random color for each detected object
const generateColor = (index: number) => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
  return colors[index % colors.length];
};

// Rate limiting for AI requests
let lastAICallTime = 0;
const MIN_AI_CALL_INTERVAL = 2000; // Minimum 2 seconds between AI calls

const NUMBER_WORD_ENTRIES: Array<[string, number]> = [
  ['one', 0],
  ['first', 0],
  ['1st', 0],
  ['two', 1],
  ['second', 1],
  ['2nd', 1],
  ['three', 2],
  ['third', 2],
  ['3rd', 2],
  ['four', 3],
  ['fourth', 3],
  ['4th', 3],
  ['five', 4],
  ['fifth', 4],
  ['5th', 4],
  ['six', 5],
  ['sixth', 5],
  ['6th', 5],
  ['seven', 6],
  ['seventh', 6],
  ['7th', 6],
  ['eight', 7],
  ['eighth', 7],
  ['8th', 7],
  ['nine', 8],
  ['ninth', 8],
  ['9th', 8],
  ['ten', 9],
  ['tenth', 9],
  ['10th', 9],
];

const SELECTION_KEYWORDS = ['option', 'options', 'choice', 'choices', 'number', 'numbers', 'pick', 'select', 'navigate', 'go to', 'take'];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Geocode result type intentionally omitted (unused) to satisfy linter

export default function NavPrototypeScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [predictions, setPredictions] = useState<any[]>([]); // Autocomplete predictions
  const [route, setRoute] = useState<any | null>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [navigating, setNavigating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [searching, setSearching] = useState(false);
  const [locationWatchId, setLocationWatchId] = useState<Location.LocationSubscription | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isListening, setIsListening] = useState(false); // Wake word listening state
  const [wakeWordRecording, setWakeWordRecording] = useState<Audio.Recording | null>(null);
  const [awaitingNumberSelection, setAwaitingNumberSelection] = useState(false); // Waiting for user to say a number
  const [locationLoading, setLocationLoading] = useState(true); // Track location loading state
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]); // AI chat history
  const [isAIMode, setIsAIMode] = useState(false); // Track if in AI chat mode vs navigation mode
  const [showChatOverlay, setShowChatOverlay] = useState(false); // Show chat history overlay
  const [travelMode, setTravelMode] = useState<'walking' | 'transit'>('walking'); // Travel mode selector
  
  // Camera and object detection states
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [isDetectionActive, setIsDetectionActive] = useState(false);
  const [isProcessingFrame, setIsProcessingFrame] = useState(false);
  const [isCameraFullscreen, setIsCameraFullscreen] = useState(false);

  const pollingRef = useRef<any>(null);
  const webviewRef = useRef<any>(null);
  const searchTimeoutRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const detectionIntervalRef = useRef<any>(null);
  const processingFrameRef = useRef(false);
  const hasSpokenStepRef = useRef<Set<number>>(new Set());
  const lastWrongWayAlertRef = useRef<number>(0);
  const destinationRef = useRef<any>(null);
  const wrongWayStartPosRef = useRef<{lat: number, lon: number} | null>(null);
  const wakeWordCheckIntervalRef = useRef<any>(null);
  const shouldListenRef = useRef<boolean>(false); // Control listening loop
  const recordingStartTimeRef = useRef<number>(0);
  const silenceDetectionIntervalRef = useRef<any>(null);
  const activeRecordingRef = useRef<Audio.Recording | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const audioStreamRef = useRef<any>(null);
  const announcedHazardsRef = useRef<Set<string>>(new Set()); // Track announced hazards to avoid repeats
  const awaitingNumberSelectionRef = useRef<boolean>(false);
  const candidatesRef = useRef<any[]>([]); // Keep ref in sync with state for realtime access
  const routeRef = useRef<any>(null); // Keep ref in sync with state for realtime access
  const navigatingRef = useRef<boolean>(false); // Keep ref in sync with state for realtime access
  const stepsRef = useRef<any[]>([]); // Keep ref in sync with state for realtime access
  const activelyListeningRef = useRef<boolean>(false); // Track if we're in active listening mode (after wake word prompt)

  const updateAwaitingNumberSelection = (value: boolean, source: string) => {
    console.log(`🔄 updateAwaitingNumberSelection called with ${value} from: ${source}`);
    awaitingNumberSelectionRef.current = value;
    setAwaitingNumberSelection(value);
  };

  // Update candidates ref whenever state changes
  const updateCandidates = (newCandidates: any[]) => {
    console.log(`📋 Updating candidates: ${newCandidates.length} items`);
    candidatesRef.current = newCandidates;
    setCandidates(newCandidates);
  };

  // Update route ref whenever state changes
  const updateRoute = (newRoute: any) => {
    console.log(`🗺️ Updating route:`, !!newRoute);
    routeRef.current = newRoute;
    setRoute(newRoute);
  };

  // Update navigating ref whenever state changes
  const updateNavigating = (value: boolean) => {
    console.log(`🧭 Updating navigating:`, value);
    navigatingRef.current = value;
    setNavigating(value);
  };

  // Update steps ref whenever state changes
  const updateSteps = (newSteps: any[]) => {
    console.log(`📍 Updating steps: ${newSteps.length} items`);
    stepsRef.current = newSteps;
    setSteps(newSteps);
  };

  // Helper function to speak without listening interference
  const speakWithoutListening = async (text: string, options?: { onDone?: () => void, restartListening?: boolean }) => {
    // Stop listening before speaking
    if (shouldListenRef.current) {
      await stopWakeWordListening();
    }
    
    // Speak with callback - Speech.speak handles timing automatically via onDone
    Speech.speak(text, {
      ...options,
      onDone: () => {
        console.log('🔇 Speech finished');
        // Call custom onDone if provided
        if (options?.onDone) {
          options.onDone();
        }
        // Restart listening if requested (default true)
        if (options?.restartListening !== false) {
          console.log('🔄 Restarting wake word listening after speech completion');
          setTimeout(() => {
            if (!shouldListenRef.current) {
              startWakeWordListening();
            }
          }, 500); // Increased delay to ensure clean handoff
        }
      },
      onError: (error) => {
        console.error('🔊 Speech error:', error);
        // Restart listening even on error
        if (options?.restartListening !== false) {
          setTimeout(() => {
            if (!shouldListenRef.current) {
              startWakeWordListening();
            }
          }, 500);
        }
      }
    });
  };

  // Helper function for brief navigation announcements - pause and resume listening
  const speakDuringNavigation = async (text: string) => {
    const wasListening = shouldListenRef.current;
    
    // Temporarily stop listening
    if (wasListening) {
      await stopWakeWordListening();
    }
    
    // Speak with callback to resume
    Speech.speak(text, {
      onDone: () => {
        if (wasListening && !shouldListenRef.current) {
          setTimeout(() => startWakeWordListening(), 500);
        }
      },
      onError: (error) => {
        console.error('🔊 Navigation speech error:', error);
        if (wasListening && !shouldListenRef.current) {
          setTimeout(() => startWakeWordListening(), 500);
        }
      }
    });
  };

  const extractOptionIndex = (rawText: string): number => {
    if (!rawText) {
      console.log('🔍 extractOptionIndex: empty text');
      return -1;
    }

    const normalized = rawText.toLowerCase();
    console.log('🔍 extractOptionIndex: normalized text:', normalized);
    
    const digitMatch = normalized.match(/\b(\d{1,2})\b/);
    if (digitMatch) {
      const parsed = parseInt(digitMatch[1], 10);
      if (!Number.isNaN(parsed)) {
        console.log('🔍 extractOptionIndex: found digit:', parsed, 'returning index:', parsed - 1);
        return parsed - 1;
      }
    }

    for (const [word, index] of NUMBER_WORD_ENTRIES) {
      const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
      if (regex.test(normalized)) {
        console.log('🔍 extractOptionIndex: found word:', word, 'returning index:', index);
        return index;
      }
    }

    console.log('🔍 extractOptionIndex: no match found');
    return -1;
  };

  const isSimpleSelectionUtterance = (rawText: string): boolean => {
    if (!rawText) {
      return false;
    }
    const normalized = rawText.toLowerCase().trim();
    if (/^\d{1,2}$/.test(normalized)) {
      return true;
    }
    return NUMBER_WORD_ENTRIES.some(([word]) => normalized === word);
  };

  const hasSelectionKeyword = (rawText: string): boolean => {
    if (!rawText) {
      return false;
    }
    const normalized = rawText.toLowerCase();
    return SELECTION_KEYWORDS.some(keyword => normalized.includes(keyword));
  };

  async function trySelectCandidate(index: number, options: { skipStreamStop?: boolean } = {}) {
    console.log(`🎯 trySelectCandidate called with index: ${index}`);
    const currentCandidates = candidatesRef.current;
    console.log(`📋 Current candidates count: ${currentCandidates.length}`);
    
    if (currentCandidates.length === 0) {
      console.log('❌ No candidates available');
      Speech.stop();
      await speakWithoutListening('There are no options to choose from yet.');
      return false;
    }

    if (index < 0 || index >= currentCandidates.length) {
      console.log(`❌ Index ${index} out of bounds (0-${currentCandidates.length - 1})`);
      const optionCount = Math.min(currentCandidates.length, 10);
      Speech.stop();
      await speakWithoutListening(`Please choose a number between one and ${optionCount}.`);
      return false;
    }

    const selected = currentCandidates[index];
    console.log(`✅ Selecting option ${index + 1}: ${selected.label}`);

    if (!options.skipStreamStop) {
      try {
        await stopRealtimeStream();
      } catch (streamError) {
        console.log('⚠️ Failed to stop realtime stream during selection:', streamError);
      }
    }

  updateAwaitingNumberSelection(false, 'trySelectCandidate');
  activelyListeningRef.current = false; // Disable active listening after selection
  Speech.stop();

  console.log('🗺️ Fetching route to selected destination...');
  await fetchRouteTo(selected);
    return true;
  }

  function postToWebView(obj: any, retries = 6) {
    const payload = JSON.stringify(obj);
    const tryPost = (n: number) => {
      if (webviewRef.current && webviewRef.current.postMessage) {
        try {
          webviewRef.current.postMessage(payload);
          return;
        } catch {}
      }
      if (n > 0) setTimeout(() => tryPost(n-1), 500);
    };
    tryPost(retries);
  }

  useEffect(() => {
    (async () => {
      console.log('📍 Requesting location permissions...');
      const { status } = await Location.requestForegroundPermissionsAsync();
      console.log('📍 Location permission status:', status);
      
      if (status !== 'granted') {
        Alert.alert('Location permission required');
        return;
      }
      
      // Get initial location
      console.log('📍 Getting initial location...');
      try {
        const loc = await Location.getCurrentPositionAsync({ 
          accuracy: Location.Accuracy.High 
        });
        console.log('✅ Initial location obtained:', loc.coords.latitude, loc.coords.longitude);
        setLocation(loc);
        setLocationLoading(false);
      } catch (err) {
        console.error('❌ Failed to get initial location:', err);
        setLocationLoading(false);
        Alert.alert('Location Error', 'Could not get your location. Please check your location settings.');
        return;
      }
      
      // Start continuous location tracking
      console.log('📍 Starting continuous location tracking...');
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000, // Update every second
          distanceInterval: 5, // Or every 5 meters
        },
        (newLocation) => {
          console.log('📍 Location updated:', newLocation.coords.latitude, newLocation.coords.longitude);
          setLocation(newLocation);
        }
      );
      setLocationWatchId(subscription);
      console.log('✅ Location tracking started');
      
      // Auto-start wake word listening after a short delay
      setTimeout(() => {
        console.log('⏰ Auto-starting wake word listening...');
        startWakeWordListening();
      }, 2000);
    })();
    
    return () => {
      console.log('🧹 Cleaning up...');
      shouldListenRef.current = false; // Stop listening loop
      
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (locationWatchId) locationWatchId.remove();
      
      // Clean up wake word recording
      if (wakeWordRecording) {
        wakeWordRecording.stopAndUnloadAsync().catch((err) => {
          console.log('Error cleaning up wake word recording:', err);
        });
      }
      
      // Clean up silence detection
      if (silenceDetectionIntervalRef.current) {
        clearInterval(silenceDetectionIntervalRef.current);
      }
      
      // Clean up real-time stream
      (async () => {
        await stopRealtimeStream();
        await stopWakeWordListening();
      })();
    };
  }, []);

  // Update map when location changes
  useEffect(() => {
    if (!location) return;
    try {
      if (webviewRef.current) {
        const msg = JSON.stringify({ 
          type: 'updateLocation', 
          coords: [location.coords.longitude, location.coords.latitude],
          heading: location.coords.heading || 0
        });
        webviewRef.current.postMessage(msg);
      }
    } catch {
      // ignore
    }
  }, [location]);

  // Object detection interval - runs during navigation
  useEffect(() => {
    if (!isDetectionActive) {
      // Clear interval and detections when stopped
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      setDetectedObjects([]);
      return;
    }

    // Request camera permission if not granted
    if (cameraPermission && !cameraPermission.granted) {
      requestCameraPermission();
    }

    // Start detection interval when active
    detectionIntervalRef.current = setInterval(() => {
      if (cameraRef.current && !processingFrameRef.current) {
        processFrame();
      }
    }, 2000); // Process frame every 2 seconds during navigation

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, [isDetectionActive, cameraPermission]);

  const metersBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    function toRad(x: number) { return x * Math.PI / 180; }
    const R = 6378137; // Earth radius in meters
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const sinDlat = Math.sin(dLat/2);
    const sinDlon = Math.sin(dLon/2);
    const a = sinDlat*sinDlat + Math.cos(lat1)*Math.cos(lat2)*sinDlon*sinDlon;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    function toRad(x: number) { return x * Math.PI / 180; }
    function toDeg(x: number) { return x * 180 / Math.PI; }
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    const bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360; // normalize to 0-360
  };

  // Fetch nearby hazards (crosswalks, traffic signals, etc.) from OpenStreetMap
  const fetchNearbyHazards = async (lat: number, lon: number, radiusMeters: number = 50) => {
    try {
      // Overpass API query for pedestrian hazards
      const query = `
        [out:json][timeout:5];
        (
          node(around:${radiusMeters},${lat},${lon})["highway"="crossing"];
          node(around:${radiusMeters},${lat},${lon})["highway"="traffic_signals"];
          node(around:${radiusMeters},${lat},${lon})["crossing"="marked"];
          node(around:${radiusMeters},${lat},${lon})["crossing"="uncontrolled"];
          node(around:${radiusMeters},${lat},${lon})["railway"="level_crossing"];
          node(around:${radiusMeters},${lat},${lon})["barrier"="kerb"];
          way(around:${radiusMeters},${lat},${lon})["highway"="construction"];
        );
        out body;
      `;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
      });
      
      if (!response.ok) return [];
      
      const data = await response.json();
      const hazards: Array<{
        id: string;
        type: string;
        lat: number;
        lon: number;
        distance: number;
        description: string;
      }> = [];
      
      for (const element of data.elements || []) {
        const hazardLat = element.lat;
        const hazardLon = element.lon;
        if (!hazardLat || !hazardLon) continue;
        
        const distance = metersBetween(lat, lon, hazardLat, hazardLon);
        
        let description = '';
        const tags = element.tags || {};
        
        if (tags.highway === 'crossing' || tags.crossing) {
          if (tags.crossing === 'uncontrolled') {
            description = 'Uncontrolled crosswalk ahead';
          } else if (tags.crossing === 'marked') {
            description = 'Marked crosswalk ahead';
          } else {
            description = 'Crosswalk ahead';
          }
        } else if (tags.highway === 'traffic_signals') {
          description = 'Traffic light ahead';
        } else if (tags.railway === 'level_crossing') {
          description = 'Railway crossing ahead, use extreme caution';
        } else if (tags.barrier === 'kerb') {
          description = 'Curb ahead';
        } else if (tags.highway === 'construction') {
          description = 'Construction zone ahead, use caution';
        }
        
        if (description) {
          hazards.push({
            id: `${element.id}-${element.type}`,
            type: tags.highway || tags.railway || tags.barrier || 'hazard',
            lat: hazardLat,
            lon: hazardLon,
            distance,
            description,
          });
        }
      }
      
      // Sort by distance
      hazards.sort((a, b) => a.distance - b.distance);
      return hazards;
      
    } catch (error) {
      console.error('Error fetching hazards:', error);
      return [];
    }
  };

  function decodePolyline(str: string, precision = 5): [number, number][] {
    let index = 0, lat = 0, lng = 0;
    const coordinates: [number, number][] = [];
    const factor = Math.pow(10, precision);
    while (index < str.length) {
      let b, shift = 0, result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += dlng;
      coordinates.push([lng / factor, lat / factor]);
    }
    return coordinates;
  }

  // Google uses the same polyline encoding, just return [lng, lat] format
  function decodeGooglePolyline(str: string): [number, number][] {
    return decodePolyline(str, 5);
  }

  // Handle search input changes with autocomplete
  function handleQueryChange(text: string) {
    setQuery(text);
    
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    // Clear predictions if text is empty
    if (!text.trim()) {
      setPredictions([]);
      updateCandidates([]);
      postToWebView({ type: 'places', places: [] });
      return;
    }
    
    // Debounce search - wait 300ms after user stops typing
    searchTimeoutRef.current = setTimeout(() => {
      if (text.trim().length >= 2) {
        performAutocomplete(text.trim());
      }
    }, 300);
  }

  function performAutocomplete(searchText: string) {
    if (!location) return;
    
    setSearching(true);
    postToWebView({
      type: 'autocomplete',
      query: searchText,
      location: {
        lat: location.coords.latitude,
        lng: location.coords.longitude
      }
    });
  }

  // Object detection function for camera frames
  const processFrame = async () => {
    if (processingFrameRef.current || !cameraRef.current || !isDetectionActive) return;
    
    processingFrameRef.current = true;
    setIsProcessingFrame(true);

    try {
      // Take a picture from the camera silently
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        skipProcessing: true,
        exif: false,
      });

      // Resize image to 640px width for detection
      const resizedImage = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      // Send to Roboflow instance segmentation API
      const response = await fetch(
        `${INSTANCE_SEGMENTATION_API_URL}?api_key=${INSTANCE_SEGMENTATION_API_KEY}&confidence=25&overlap=50`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: resizedImage.base64,
        }
      );

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Parse Roboflow response and filter for confidence > 0.3
      const objects: DetectedObject[] = (data.predictions || [])
        .filter((obj: any) => (obj.confidence || 0) > 0.3)
        .map((obj: any, index: number) => ({
          label: obj.class || 'Unknown',
          confidence: obj.confidence || 0,
          bbox: [
            obj.x - obj.width / 2,
            obj.y - obj.height / 2,
            obj.width,
            obj.height,
          ],
          color: generateColor(index),
        }));

      setDetectedObjects(objects);
      
      // Announce critical obstacles during navigation
      if (navigatingRef.current && objects.length > 0) {
        announceObstacles(objects);
      }
    } catch (error) {
      console.error('Error processing frame:', error);
    } finally {
      processingFrameRef.current = false;
      setIsProcessingFrame(false);
    }
  };

  // Announce detected obstacles to the user
  const announceObstacles = (objects: DetectedObject[]) => {
    // Only announce high-confidence obstacles (> 60%)
    const criticalObstacles = objects.filter(obj => obj.confidence > 0.6);
    
    if (criticalObstacles.length === 0) return;
    
    // Group by type
    const obstacleTypes = new Map<string, number>();
    criticalObstacles.forEach(obj => {
      obstacleTypes.set(obj.label, (obstacleTypes.get(obj.label) || 0) + 1);
    });
    
    // Create announcement
    const announcements: string[] = [];
    obstacleTypes.forEach((count, label) => {
      if (count === 1) {
        announcements.push(`${label} ahead`);
      } else {
        announcements.push(`${count} ${label}s ahead`);
      }
    });
    
    if (announcements.length > 0) {
      const message = announcements.join(', ');
      speakDuringNavigation(message);
    }
  };

  async function searchPlaces(searchText?: string, providedLocation?: Location.LocationObject) {
    const searchQuery = searchText || query.trim();
    const currentLocation = providedLocation || location;
    
    console.log('🔍 searchPlaces called with query:', searchQuery);
    console.log('📍 Current location state:', currentLocation ? 'Available' : 'NOT AVAILABLE');
    
    if (!currentLocation) {
      console.warn('⚠️ Location not available, waiting...');
      
      // Try to get location again (silently)
      try {
        const loc = await Location.getCurrentPositionAsync({ 
          accuracy: Location.Accuracy.Balanced
        });
        console.log('✅ Location obtained:', loc.coords.latitude, loc.coords.longitude);
        setLocation(loc);
        
        // Use the newly obtained location directly instead of waiting for state update
        searchPlaces(searchQuery, loc);
      } catch (err) {
        console.error('❌ Failed to get location:', err);
        Alert.alert('Location Error', 'Could not get your location. Please enable location services.');
      }
      return;
    }
    
    if (!searchQuery) {
      console.warn('⚠️ Empty search query');
      Alert.alert('Please enter a search term');
      return;
    }
    
    Speech.stop();
    setSearching(true);
    setPredictions([]); // Clear autocomplete when doing full search
  updateAwaitingNumberSelection(false, 'searchPlaces'); // Clear any previous number selection mode
    
    try {
      console.log('🔍 Searching for:', searchQuery);
      console.log('📍 Using location:', currentLocation.coords.latitude, currentLocation.coords.longitude);
      
      postToWebView({
        type: 'search',
        query: searchQuery,
        location: {
          lat: currentLocation.coords.latitude,
          lng: currentLocation.coords.longitude
        }
      });
      
      console.log('✅ Search message sent to WebView:', {
        query: searchQuery,
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude
      });
    } catch (err) {
      console.error('❌ Search error:', err);
      Alert.alert('Search failed', 'Please try again');
      updateCandidates([]);
      setSearching(false);
    }
  }
  
  // Quick category search (like Google Maps)
  function searchCategory(category: string) {
    setQuery(category);
    searchPlaces(category);
  }

  // Voice search functions with wake word detection using real-time streaming
  async function startWakeWordListening() {
    try {
      // Prevent starting if already listening - use ref as source of truth
      if (shouldListenRef.current) {
        console.log('⚠️ Already listening (shouldListenRef=true), skipping start');
        return;
      }
      
      // Request audio recording permissions
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant microphone permission to use voice search');
        return;
      }

      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      shouldListenRef.current = true; // Enable listening loop
      setIsListening(true);
      console.log('🎙️ Wake word listening started - Say "Cosmo"');
      
      // Welcome message removed - see Instructions tab
      // Speech.speak('Voice ready. Say Cosmo.');
      
      // Start real-time streaming
      startRealtimeStream();
      
    } catch (err) {
      console.error('Failed to start wake word listening:', err);
      Alert.alert('Wake word failed', 'Could not start wake word detection');
    }
  }

  async function startRealtimeStream() {
    try {
      if (!SPEECH_API_KEY) {
        console.error('❌ No Speech API key found');
        return;
      }

      console.log('🔌 Starting optimized chunk-based streaming...');
      
      // Use the faster chunk-based approach with immediate processing
      continuousListenOptimized();

    } catch (err) {
      console.error('❌ Failed to start real-time stream:', err);
    }
  }

  async function continuousListenOptimized() {
    // Optimized continuous listening with faster processing
    while (shouldListenRef.current) {
      try {
        // Check if we should continue before starting new recording
        if (!shouldListenRef.current) {
          console.log('Loop stopped by flag before recording');
          break;
        }
        
        console.log('Starting recording cycle...');
        
        // Clean up any existing recordings to prevent conflicts
        if (audioStreamRef.current) {
          try {
            await audioStreamRef.current.stopAndUnloadAsync();
          } catch (err: any) {
            // Silently ignore "already unloaded" errors
            if (!err?.message?.includes('already been unloaded')) {
              console.log('Error stopping audioStreamRef:', err);
            }
          }
          audioStreamRef.current = null;
        }
        if (wakeWordRecording) {
          try {
            await wakeWordRecording.stopAndUnloadAsync();
          } catch (err: any) {
            // Silently ignore "already unloaded" errors
            if (!err?.message?.includes('already been unloaded')) {
              console.log('Error stopping wakeWordRecording:', err);
            }
          }
          setWakeWordRecording(null);
        }
        
        // Check again after cleanup
        if (!shouldListenRef.current) {
          console.log('Loop stopped during cleanup');
          break;
        }
        
        // Small delay to ensure cleanup completes
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Record 1.5-second audio clips for faster response
        try {
          const { recording: newRecording } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          
          setWakeWordRecording(newRecording);
          audioStreamRef.current = newRecording;
          
          // Wait 1.5 seconds (optimized for responsiveness)
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          if (!shouldListenRef.current) {
            await newRecording.stopAndUnloadAsync().catch(() => {});
            setWakeWordRecording(null);
            audioStreamRef.current = null;
            break;
          }
          
          // Get URI before stopping (important!)
          const uri = newRecording.getURI();
          
          // Stop and unload the recording
          await newRecording.stopAndUnloadAsync();
          
          setWakeWordRecording(null);
          audioStreamRef.current = null;
          
          if (uri && shouldListenRef.current) {
            // Process immediately without waiting
            checkForWakeWord(uri).catch((err: any) => {
              console.log('Transcription skipped:', err?.message || err);
            });
          }
        } catch (recordingError: any) {
          // Silently handle "only one recording" errors - just skip this cycle
          if (!recordingError?.message?.includes('only one recording')) {
            console.log('Recording creation error:', recordingError?.message || recordingError);
          }
          // Wait a bit before trying again
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // No delay - immediate next recording for continuous feel
        
      } catch (err) {
        console.error('Recording cycle error:', err);
        setWakeWordRecording(null);
        audioStreamRef.current = null;
        if (shouldListenRef.current) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    
    console.log('🛑 Optimized listening loop ended');
    setWakeWordRecording(null);
    audioStreamRef.current = null;
  }

  async function startAudioStream() {
    // Placeholder - not used in chunk-based approach
    console.log('Using chunk-based streaming');
  }

  async function streamAudioToWebSocket(recording: Audio.Recording) {
    // Placeholder - not used in chunk-based approach
  }

  async function handleRealtimeTranscript(text: string) {
    console.log('🎯 Handling transcript:', text);
    console.log('📊 State - navigating:', navigatingRef.current, 'route:', !!routeRef.current, 'awaitingNumber:', awaitingNumberSelectionRef.current, 'activelyListening:', activelyListeningRef.current);

    const lowerText = text.toLowerCase();

    // PRIORITY: Check for stop command when navigating - works WITHOUT wake word
    if (navigatingRef.current && lowerText.includes('stop')) {
      console.log('✅ Stop command detected during navigation!');
      stopNavigation(false); // Manual stop via voice command
      return;
    }

    // If we're in active listening mode (user was prompted), process commands without requiring wake word
    if (activelyListeningRef.current) {
      console.log('🎤 Active listening mode - processing command directly');
      
      // Process the command without wake word requirement
      // Note: processActiveCommand will reset activelyListeningRef if needed
      await processActiveCommand(text);
      return;
    }

    // PASSIVE LISTENING MODE: Only respond to wake word
    const hasWakeWord = lowerText.includes('cosmo') || lowerText.includes('cosimo') || lowerText.includes('cosmos');
    
    if (!hasWakeWord) {
      console.log('⏭️ Passive mode: No wake word detected, ignoring transcript');
      return;
    }

    console.log('✅ Wake word detected!');
    await stopRealtimeStream();
    updateAwaitingNumberSelection(false, 'handleRealtimeTranscript');
    
    // Extract the command that comes AFTER the wake word
    const commandAfterWakeWord = extractCommandAfterWakeWord(lowerText);
    console.log('📝 Command after wake word:', commandAfterWakeWord);
    
    // Check if the command includes immediate instructions
    if (commandAfterWakeWord) {
      // Check for repeat command when navigating
      if (navigatingRef.current && (commandAfterWakeWord.includes('repeat') || commandAfterWakeWord.includes('again') || commandAfterWakeWord.includes('what'))) {
        console.log('✅ Repeat command detected after wake word!');
        repeatInstruction();
        setTimeout(() => startWakeWordListening(), 1000);
        return;
      }

      // Check for "start navigation" command when route is ready but not navigating
      if (routeRef.current && !navigatingRef.current) {
        const startPhrases = [
          'start navigation',
          'begin navigation',
          'start navigating',
          'begin navigating',
          'navigate',
          'let\'s navigate',
          'let\'s go',
          'start the navigation',
          'begin the navigation',
          'start',
          'begin',
          'go'
        ];
        
        const hasStartCommand = startPhrases.some(phrase => commandAfterWakeWord.includes(phrase));
        
        console.log('🔍 Checking start command:', {
          hasRoute: !!routeRef.current,
          isNavigating: navigatingRef.current,
          commandAfterWakeWord,
          hasStartCommand
        });
        
        if (hasStartCommand) {
          console.log('✅ Start navigation command detected after wake word!');
          Speech.speak('Starting navigation');
          setTimeout(() => {
            console.log('⏰ Starting navigation now');
            startNavigation();
          }, 300);
          return;
        } else {
          console.log('⚠️ No start command matched in:', commandAfterWakeWord);
        }
      } else {
        console.log('⚠️ Cannot start navigation:', {
          hasRoute: !!routeRef.current,
          isNavigating: navigatingRef.current
        });
      }

      // Check if user is selecting a numbered option
      if (candidatesRef.current.length > 0) {
        const selectionIndex = extractOptionIndex(commandAfterWakeWord);
        
        if (selectionIndex >= 0) {
          console.log('🎯 Selection detected after wake word. Index:', selectionIndex);
          await trySelectCandidate(selectionIndex);
          return;
        }
      }
    }
    
    // No specific command detected, so prompt user for input and enter active listening mode
    activelyListeningRef.current = true; // Enable active listening for next transcript
    await speakWithoutListening('Yes? How can I help?', { restartListening: false });
    setTimeout(() => startVoiceSearch(), 2000);
  }

  // Process commands when in active listening mode (no wake word required)
  async function processActiveCommand(text: string) {
    const lowerText = text.toLowerCase();
    
    console.log('🎤 processActiveCommand called with:', text);
    console.log('📊 State:', {
      candidates: candidatesRef.current.length,
      hasRoute: !!routeRef.current,
      isNavigating: navigatingRef.current
    });
    
    // Check for repeat command when navigating (highest priority during navigation)
    if (navigatingRef.current && (lowerText.includes('repeat') || lowerText.includes('again') || lowerText.includes('what'))) {
      console.log('✅ Repeat command in active mode!');
      repeatInstruction();
      setTimeout(() => startWakeWordListening(), 1000);
      return;
    }

    // Check for "start navigation" command when route is ready but not navigating
    // This should be checked BEFORE option selection to avoid mishearing "start" as a number
    if (routeRef.current && !navigatingRef.current && candidatesRef.current.length === 0) {
      const startPhrases = [
        'start navigation',
        'begin navigation',
        'start navigating',
        'begin navigating',
        'navigate',
        'let\'s navigate',
        'let\'s go',
        'start the navigation',
        'begin the navigation',
        'start',
        'begin',
        'go'
      ];
      
      const hasStartCommand = startPhrases.some(phrase => lowerText.includes(phrase));
      
      console.log('🔍 Active mode - Checking start command:', {
        hasRoute: !!routeRef.current,
        isNavigating: navigatingRef.current,
        lowerText,
        hasStartCommand
      });
      
      if (hasStartCommand) {
        console.log('✅ Start navigation command in active mode!');
        startNavigation();
        return;
      }
    }

    // Check if user is selecting a numbered option (when candidates are present)
    if (candidatesRef.current.length > 0) {
      const selectionIndex = extractOptionIndex(text);
      
      console.log('🔍 Checking option selection:', {
        text,
        lowerText,
        selectionIndex,
        candidatesCount: candidatesRef.current.length
      });
      
      if (selectionIndex >= 0) {
        console.log('🎯 Selection in active mode. Index:', selectionIndex);
        await trySelectCandidate(selectionIndex);
        return;
      } else {
        console.log('⚠️ No valid option index extracted from:', text);
      }
    }

    // If no direct command matches and text is empty, it's probably silence - keep waiting
    // Only return to passive listening if we actually got a transcript that didn't match
    if (text.trim()) {
      console.log('💬 No direct command match in active mode, returning to passive listening');
      activelyListeningRef.current = false;
      setTimeout(() => startWakeWordListening(), 500);
    } else {
      console.log('⏸️ Empty transcript in active mode - continuing to listen');
      // Keep activelyListeningRef.current = true and continue waiting
    }
  }

  // Helper function to extract command text that comes after wake word
  function extractCommandAfterWakeWord(text: string): string {
    const lowerText = text.toLowerCase();
    
    // Find wake word position
    let wakeWordIndex = -1;
    let wakeWordLength = 0;
    
    if (lowerText.includes('hey cosmo')) {
      wakeWordIndex = lowerText.indexOf('hey cosmo');
      wakeWordLength = 9;
    } else if (lowerText.includes('cosmo')) {
      wakeWordIndex = lowerText.indexOf('cosmo');
      wakeWordLength = 5;
    } else if (lowerText.includes('cosimo')) {
      wakeWordIndex = lowerText.indexOf('cosimo');
      wakeWordLength = 6;
    } else if (lowerText.includes('cosmos')) {
      wakeWordIndex = lowerText.indexOf('cosmos');
      wakeWordLength = 6;
    }
    
    if (wakeWordIndex === -1) {
      return '';
    }
    
    // Extract everything after the wake word
    const afterWakeWord = lowerText.substring(wakeWordIndex + wakeWordLength).trim();
    
    // Remove common filler words at the start
    return afterWakeWord.replace(/^(can you|could you|please|,|\.)\s*/gi, '').trim();
  }

  async function stopRealtimeStream() {
    console.log('🛑 Stopping optimized stream');
    
    shouldListenRef.current = false;
    setIsListening(false);

    // Stop recording and wait for cleanup
    if (audioStreamRef.current) {
      try {
        await audioStreamRef.current.stopAndUnloadAsync();
      } catch (err: any) {
        // Silently handle already unloaded recordings
        if (!err?.message?.includes('already been unloaded')) {
          console.log('Error stopping audio stream:', err);
        }
      }
      audioStreamRef.current = null;
    }

    if (wakeWordRecording) {
      try {
        await wakeWordRecording.stopAndUnloadAsync();
      } catch (err: any) {
        // Silently handle already unloaded recordings
        if (!err?.message?.includes('already been unloaded')) {
          console.log('Error stopping wake word recording:', err);
        }
      }
      setWakeWordRecording(null);
    }
  }

  async function continuousListen() {
    // Optimized continuous loop with speech detection
    while (shouldListenRef.current) {
      try {
        console.log('🔄 Listening for wake word...');
        
        // Clean up any existing recording first
        if (wakeWordRecording) {
          try {
            await wakeWordRecording.stopAndUnloadAsync();
          } catch (err) {
            console.log('Cleanup error:', err);
          }
          setWakeWordRecording(null);
        }
        
        // Small delay to ensure cleanup completes
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const { recording: newRecording } = await Audio.Recording.createAsync({
          isMeteringEnabled: true,
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        });
        
        setWakeWordRecording(newRecording);
        
        // Shorter clip for faster detection - 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (!shouldListenRef.current) {
          await newRecording.stopAndUnloadAsync().catch(() => {});
          setWakeWordRecording(null);
          break;
        }
        
        // Check if there was any speech in this clip
        const status = await newRecording.getStatusAsync();
        const hasSpeech = status.metering !== undefined && status.metering > -40;
        
        await newRecording.stopAndUnloadAsync();
        const uri = newRecording.getURI();
        
        setWakeWordRecording(null);
        
        // Only check for wake word if there was actual speech detected
        if (uri && shouldListenRef.current && hasSpeech) {
          console.log('🎯 Speech detected, checking for wake word...');
          await checkForWakeWord(uri).catch((err) => {
            // Silent fail for wake word check errors
          });
        }
        
        // Very short pause between cycles for faster response
        if (shouldListenRef.current) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
      } catch (err) {
        console.error('Recording cycle error:', err);
        setWakeWordRecording(null);
        if (shouldListenRef.current) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    console.log('🛑 Continuous listening loop ended');
    setWakeWordRecording(null);
  }

  async function checkForWakeWord(audioUri: string) {
    try {
      if (!SPEECH_API_KEY) return;

      // Upload and transcribe the audio
      const audioResponse = await fetch(audioUri);
      const audioBlob = await audioResponse.blob();
      
      // Upload to AssemblyAI
      const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'authorization': SPEECH_API_KEY,
          'Content-Type': 'application/octet-stream',
        },
        body: audioBlob,
      });

      if (!uploadResponse.ok) return;

      const { upload_url } = await uploadResponse.json();

      // Request transcription
      const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'authorization': SPEECH_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_url: upload_url,
          language_code: 'en',
        }),
      });

      if (!transcriptResponse.ok) return;

      const { id: transcriptId } = await transcriptResponse.json();

      // Fast polling for wake word - shorter timeout
      let attempts = 0;
      while (attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const pollingResponse = await fetch(
          `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
          { headers: { 'authorization': SPEECH_API_KEY } }
        );

        const result = await pollingResponse.json();
        
        if (result.status === 'completed') {
          const text = result.text?.toLowerCase() || '';
          console.log('🎤 Heard:', text);
          
          // Use unified command handler
          await handleRealtimeTranscript(text);
          break;
        } else if (result.status === 'error') {
          break;
        }
        
        attempts++;
      }
    } catch (err) {
      // Silent fail
    }
  }

  async function stopWakeWordListening() {
    console.log('🛑 Stopping wake word listening');
    await stopRealtimeStream();
    console.log('Wake word listening stopped');
  }

  async function startVoiceSearch() {
    try {
      console.log('🎤 Starting voice search with pause detection...');
      
      // Ensure wake word recording is fully stopped
      await stopRealtimeStream();
      
      // Add small delay to ensure all audio resources are released
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      
      // Clean up any existing recordings
      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch (err) {
          console.log('Error stopping existing recording:', err);
        }
        setRecording(null);
      }
      
      // Extra delay after cleanup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Start recording with metering enabled for silence detection
      try {
        const { recording: newRecording } = await Audio.Recording.createAsync({
          isMeteringEnabled: true, // CRITICAL: Enable metering for pause detection
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          android: {
            ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 44100,
            numberOfChannels: 2,
            bitRate: 128000,
          },
          ios: {
            ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
            extension: '.m4a',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 44100,
            numberOfChannels: 2,
            bitRate: 128000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {
            mimeType: 'audio/webm',
            bitsPerSecond: 128000,
          },
        });
        
        setRecording(newRecording);
        activeRecordingRef.current = newRecording; // Store in ref to prevent race conditions
        setIsRecording(true);
        recordingStartTimeRef.current = Date.now();
        
        console.log('✅ Recording started - speak now, pause for 1.5 seconds to search');
        
        // Start monitoring for pauses using recording status
        monitorRecordingForPause(newRecording);
        
        // Absolute maximum recording time (15 seconds - reduced from 20)
        setTimeout(() => {
          if (isRecording && activeRecordingRef.current) {
            console.log('⏰ Max recording time reached (15s), processing...');
            stopVoiceSearch();
          }
        }, 15000);
      } catch (recordingError: any) {
        // Handle recording creation errors silently if it's the "only one recording" error
        if (recordingError?.message?.includes('only one recording')) {
          console.log('⚠️ Recording already in progress, skipping voice search');
        } else {
          throw recordingError; // Re-throw other errors
        }
      }
      
    } catch (err) {
      console.error('❌ Failed to start recording:', err);
      Alert.alert('Recording failed', 'Could not start voice recording');
      activeRecordingRef.current = null;
    }
  }

  async function monitorRecordingForPause(recordingInstance: Audio.Recording) {
    let consecutiveLowLevelChecks = 0;
    let baselineNoise = -30; // Will be calibrated
    let volumeHistory: number[] = [];
    let hasDetectedSpeech = false;
    
    console.log('🎯 Starting smart pause detection with noise adaptation');
    
    silenceDetectionIntervalRef.current = setInterval(async () => {
      try {
        const status = await recordingInstance.getStatusAsync();
        
        if (!status.isRecording) {
          clearInterval(silenceDetectionIntervalRef.current);
          return;
        }
        
        const recordingDuration = status.durationMillis || 0;
        
        // Calibrate baseline noise in first second
        if (recordingDuration < 1000 && status.metering !== undefined) {
          volumeHistory.push(status.metering);
          if (volumeHistory.length >= 2) {
            baselineNoise = Math.max(...volumeHistory);
            console.log(`📊 Baseline noise calibrated to: ${baselineNoise.toFixed(1)}dB`);
          }
          return;
        }
        
        if (status.metering !== undefined) {
          const currentVolume = status.metering;
          console.log(`🎚️ Volume: ${currentVolume.toFixed(1)}dB (baseline: ${baselineNoise.toFixed(1)}dB)`);
          
          // Detect speech: volume significantly above baseline (10dB louder)
          if (currentVolume > baselineNoise + 10) {
            hasDetectedSpeech = true;
            consecutiveLowLevelChecks = 0;
            console.log('🗣️ Speech detected');
          }
          // Detect pause: volume back near baseline AFTER speech was detected
          else if (hasDetectedSpeech && currentVolume <= baselineNoise + 5) {
            consecutiveLowLevelChecks++;
            console.log(`⏸️ Pause detected (${(consecutiveLowLevelChecks * 0.5).toFixed(1)}s / 3.0s needed)`);
          }
          // Still speaking or ramping up
          else if (currentVolume > baselineNoise + 5) {
            if (consecutiveLowLevelChecks > 0) {
              console.log('🔊 Speech resumed, resetting pause counter');
            }
            hasDetectedSpeech = true;
            consecutiveLowLevelChecks = 0;
          }
        } else {
          // No metering data, fallback behavior
          if (hasDetectedSpeech) {
            consecutiveLowLevelChecks++;
          }
        }
        
        // 3 seconds of pause after speech detected
        if (consecutiveLowLevelChecks >= 6) {
          console.log('✅ 3 seconds of pause detected, processing speech...');
          clearInterval(silenceDetectionIntervalRef.current);
          stopVoiceSearch();
        }
        
      } catch (err) {
        console.error('❌ Error monitoring recording:', err);
      }
    }, 500);
  }

  async function stopVoiceSearch() {
    const recordingToStop = activeRecordingRef.current || recording;
    
    if (!recordingToStop) {
      console.log('⚠️ No recording to stop');
      return;
    }

    try {
      // Clear monitoring interval
      if (silenceDetectionIntervalRef.current) {
        clearInterval(silenceDetectionIntervalRef.current);
        silenceDetectionIntervalRef.current = null;
      }
      
      setIsRecording(false);
      
      console.log('⏹️ Stopping recording...');
      await recordingToStop.stopAndUnloadAsync();
      const uri = recordingToStop.getURI();
      
      console.log('📁 Recording URI:', uri);
      
      if (uri) {
        console.log('🚀 Starting transcription...');
        // Send audio to AssemblyAI
        await transcribeAudio(uri);
      } else {
        console.error('❌ No URI from recording');
        // Speech.speak('Recording failed. Please try again.');
      }
      
      setRecording(null);
      activeRecordingRef.current = null;
      
      // Don't restart listening here - let the search results handler do it
      // after announcing the options. This prevents starting the mic before
      // activelyListeningRef is set to true.
    } catch (err) {
      console.error('❌ Failed to stop recording:', err);
      Alert.alert('Recording failed', 'Could not process voice recording');
      setRecording(null);
      activeRecordingRef.current = null;
      
      // On error, restart listening since search results won't come
      setTimeout(() => {
        if (!shouldListenRef.current && !navigating) {
          startWakeWordListening();
        }
      }, 500);
    }
  }

  async function transcribeAudio(audioUri: string) {
    try {
      console.log('🎯 Starting transcription for:', audioUri);
      
      if (!SPEECH_API_KEY) {
        console.error('❌ No Speech API key found');
        Alert.alert('API Key missing', 'Please add your Speech-to-Text API key to .env');
        return;
      }

      // Read the audio file
      console.log('📖 Reading audio file...');
      const audioResponse = await fetch(audioUri);
      const audioBlob = await audioResponse.blob();
      console.log('✅ Audio file read, size:', audioBlob.size, 'bytes');
      
      // Step 1: Upload audio file to AssemblyAI
      console.log('📤 Uploading to AssemblyAI...');
      const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'authorization': SPEECH_API_KEY,
          'Content-Type': 'application/octet-stream',
        },
        body: audioBlob,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('❌ Upload failed:', uploadResponse.status, errorText);
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }

      const { upload_url } = await uploadResponse.json();
      console.log('✅ Audio uploaded:', upload_url);

      // Step 2: Request transcription
      console.log('🔄 Requesting transcription...');
      const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'authorization': SPEECH_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_url: upload_url,
          language_code: 'en',
        }),
      });

      if (!transcriptResponse.ok) {
        const errorText = await transcriptResponse.text();
        console.error('❌ Transcription request failed:', transcriptResponse.status, errorText);
        throw new Error(`Transcription request failed: ${transcriptResponse.status}`);
      }

      const { id: transcriptId } = await transcriptResponse.json();
      console.log('✅ Transcription started, ID:', transcriptId);

      // Step 3: Poll for transcription result
      let transcriptResult = null;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds max

      console.log('⏳ Polling for results...');
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        const pollingResponse = await fetch(
          `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
          {
            headers: {
              'authorization': SPEECH_API_KEY,
            },
          }
        );

        const result = await pollingResponse.json();
        console.log(`📊 Polling attempt ${attempts + 1}/${maxAttempts}, status:`, result.status);
        
        if (result.status === 'completed') {
          transcriptResult = result;
          console.log('✅ Transcription completed!');
          break;
        } else if (result.status === 'error') {
          console.error('❌ Transcription error:', result.error);
          throw new Error('Transcription failed');
        }
        
        attempts++;
      }

      if (transcriptResult && transcriptResult.text) {
        const transcribedText = transcriptResult.text;
        console.log('📝 Transcribed text:', transcribedText);
        
        // Remove "cosmo" from the beginning if present
        const cleanedText = transcribedText.toLowerCase().replace(/^(hey\s+)?cosmo\s*/i, '').trim();
        console.log('🧹 Cleaned text:', cleanedText);
        
        if (!cleanedText) {
          console.log('⚠️ No text after cleaning');
          // Restart wake word listening
          setTimeout(() => {
            if (!shouldListenRef.current) {
              startWakeWordListening();
            }
          }, 500);
          return;
        }
        
        // Send everything to AI for intelligent routing
        console.log('🤖 Sending to AI for processing...');
        await processWithAI(cleanedText);
      } else {
        console.log('⚠️ No transcription result or text');
        // Restart wake word listening
        setTimeout(() => {
          if (!shouldListenRef.current) {
            startWakeWordListening();
          }
        }, 500);
      }
      
    } catch (err) {
      console.error('❌ Transcription error:', err);
    }
  }

  async function processWithAI(userInput: string) {
    try {
      console.log('🤖 Processing with AI:', userInput);
      console.log('📊 Current state - candidates:', candidatesRef.current.length, 'navigating:', navigatingRef.current, 'route:', !!routeRef.current);
      
      // Check for direct voice commands first (navigation control)
      const lowerInput = userInput.toLowerCase();
      
      // Command: Change travel mode - More specific to avoid false triggers
      // Walking mode triggers
      const walkingPhrases = [
        'walking mode', 'walk mode', 'use walking', 'switch to walking', 
        'change to walking', 'enable walking', 'activate walking',
        'pedestrian mode', 'on foot', 'by foot'
      ];
      const shouldSwitchToWalking = walkingPhrases.some(phrase => lowerInput.includes(phrase));
      
      // Transit mode triggers
      const transitPhrases = [
        'transit mode', 'use transit', 'switch to transit', 'change to transit',
        'enable transit', 'activate transit', 'public transit', 
        'use bus', 'use train', 'use subway', 'use metro',
        'take the bus', 'take the train', 'take the subway', 'take transit',
        'bus mode', 'train mode', 'subway mode'
      ];
      const shouldSwitchToTransit = transitPhrases.some(phrase => lowerInput.includes(phrase));
      
      if (shouldSwitchToWalking && !shouldSwitchToTransit) {
        setTravelMode('walking');
        await speakWithoutListening('Switched to walking mode. I will now provide walking directions.');
        return;
      } else if (shouldSwitchToTransit && !shouldSwitchToWalking) {
        setTravelMode('transit');
        await speakWithoutListening('Switched to public transit mode. I will now provide directions using buses and trains.');
        return;
      }
      
      // Command: Choose option (HIGHEST PRIORITY - check this first!)
      if (candidatesRef.current.length > 0) {
        const optionIndex = extractOptionIndex(lowerInput);
        const selectionIntent = optionIndex >= 0 && (awaitingNumberSelectionRef.current || hasSelectionKeyword(lowerInput) || isSimpleSelectionUtterance(lowerInput));

        if (selectionIntent) {
          console.log('✅ Selecting option via AI pipeline. Index:', optionIndex);
          await trySelectCandidate(optionIndex, { skipStreamStop: true });
          return;
        }
      }
      
      // Command: Help
      if (lowerInput.includes('help') || lowerInput === 'what can you do' || lowerInput.includes('commands')) {
        const helpMessage = `Here are the voice commands you can use: 
        Say, Find the nearest coffee shop, to search for places. 
        Say, Choose option 1, to select from search results. 
        To change travel modes, say Switch to transit mode, or Switch to walking mode. You can also just say, Use the bus, or Use transit.
        Say, Start navigation, to begin your route. 
        Say, Stop navigation, to end your route. 
        Say, Repeat, to hear the current instruction again during navigation.
        Say, Repeat options, to hear the search results again. 
        You can also ask me about the weather or general questions. 
        I will warn you about crosswalks and hazards during navigation.`;
        await speakWithoutListening(helpMessage);
        return;
      }
      
      // Command: Stop navigation (check refs, not state!)
      if ((lowerInput.includes('stop') || lowerInput.includes('end') || lowerInput.includes('cancel')) && 
          (lowerInput.includes('navigation') || lowerInput.includes('navigating') || lowerInput.includes('route'))) {
        console.log('🛑 Stop navigation command in AI path - navigating:', navigatingRef.current);
        if (navigatingRef.current) {
          await speakWithoutListening('Stopping navigation', { restartListening: false });
          stopNavigation(false); // Manual stop via AI command
          return;
        } else {
          await speakWithoutListening('Navigation is not active');
          return;
        }
      }
      
      // Command: Start navigation (check refs, not state!)
      if ((lowerInput.includes('start') || lowerInput.includes('begin') || lowerInput.includes('go')) && 
          (lowerInput.includes('navigation') || lowerInput.includes('navigate') || lowerInput.includes('route'))) {
        console.log('🚀 Start navigation command in AI path - route:', !!routeRef.current, 'navigating:', navigatingRef.current);
        if (routeRef.current && stepsRef.current.length > 0 && !navigatingRef.current) {
          startNavigation();
          return;
        } else if (navigatingRef.current) {
          await speakWithoutListening('Navigation is already active');
          return;
        } else {
          await speakWithoutListening('Please select a destination first');
          return;
        }
      }
      
      // Command: Repeat/list options
      if ((lowerInput.includes('repeat') || lowerInput.includes('list') || lowerInput.includes('what are')) && 
          (lowerInput.includes('option') || lowerInput.includes('result') || lowerInput.includes('choice'))) {
        if (candidates.length > 0) {
          let announcement = `Here are the options: `;
          candidates.slice(0, 5).forEach((candidate, index) => {
            announcement += `Option ${index + 1}: ${candidate.label}, ${(candidate.distance / 1000).toFixed(1)} kilometers away. `;
          });
          await speakWithoutListening(announcement);
          return;
        } else {
          await speakWithoutListening('No search results available. Please search for a location first.');
          return;
        }
      }
      
      // Check rate limiting for AI calls
      const now = Date.now();
      const timeSinceLastCall = now - lastAICallTime;
      
      if (timeSinceLastCall < MIN_AI_CALL_INTERVAL) {
        const waitTime = MIN_AI_CALL_INTERVAL - timeSinceLastCall;
        console.log(`⏳ Rate limiting: waiting ${waitTime}ms before AI call`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      lastAICallTime = Date.now();
      
      // Build prompt for AI to decide action
      const systemPrompt = `You are Cosmo, a helpful AI navigation assistant. Analyze the user's request and respond with a JSON object.

If the user wants to navigate somewhere or find a location, respond with:
{"action": "navigate", "location": "extracted location name"}

If the user is asking a general question (about weather, facts, how-to, etc.), respond with:
{"action": "answer", "response": "your helpful answer here"}

Examples:
- "Take me to Starbucks" → {"action": "navigate", "location": "Starbucks"}
- "Find the nearest gas station" → {"action": "navigate", "location": "gas station"}
- "What's the weather like?" → {"action": "answer", "response": "Let me check the weather for you..."}
- "How do I make coffee?" → {"action": "answer", "response": "To make coffee, you'll need..."}

User request: "${userInput}"

Respond ONLY with the JSON object, no other text.`;

      let retries = 0;
      let lastError = null;
      
      // Retry with exponential backoff
      while (retries < 3) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-2.0-flash-lite",
            contents: systemPrompt,
          });
          
          const text = response.text || '';
          console.log('🤖 AI raw response:', text);
          
          // Extract JSON from response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in AI response');
          }
          
          const aiDecision = JSON.parse(jsonMatch[0]);
          console.log('🎯 AI decision:', aiDecision);
          
          if (aiDecision.action === 'navigate') {
            // Navigation mode
            console.log('🗺️ AI says: Navigate to', aiDecision.location);
            setIsAIMode(false);
            setQuery(aiDecision.location);
            searchPlaces(aiDecision.location);
          } else if (aiDecision.action === 'answer') {
            // Answer mode - get actual AI response with real data
            console.log('💬 AI says: Answer the question');
            setIsAIMode(true);
            setShowChatOverlay(true);
            
            // Add user message to chat history
            setChatHistory(prev => [
              ...prev,
              { role: 'user', text: userInput }
            ]);
            
            // Check if it's a weather question
            const weatherKeywords = ['weather', 'temperature', 'forecast', 'hot', 'cold', 'rain', 'sunny', 'climate'];
            const isWeatherQuery = weatherKeywords.some(keyword => userInput.toLowerCase().includes(keyword));
            
            if (isWeatherQuery) {
              // For weather questions, say we're checking and then get real data
              Speech.speak("Let me check that for you.");
              await new Promise(resolve => setTimeout(resolve, 1500));
              await getAIResponse(userInput);
            } else {
              // For non-weather questions, get AI response directly
              await getAIResponse(userInput);
            }
          }
          
          // Success - exit retry loop
          return;
          
        } catch (err: any) {
          lastError = err;
          
          // Check if it's a rate limit error
          if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
            retries++;
            if (retries < 3) {
              const backoffTime = Math.pow(2, retries) * 1000; // 2s, 4s, 8s
              console.log(`⏳ Rate limit hit, retry ${retries}/3 after ${backoffTime}ms`);
              await new Promise(resolve => setTimeout(resolve, backoffTime));
              continue;
            }
          }
          
          // Non-rate-limit error or max retries reached
          throw err;
        }
      }
      
      // If we get here, all retries failed
      throw lastError;
      
    } catch (err: any) {
      console.error('❌ AI processing error:', err);
      
      // Check if it's a rate limit error after all retries
      if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
        console.log('⚠️ Rate limit persists - using fallback keyword routing');
        await speakWithoutListening("I'm experiencing high demand. Using backup mode.", { restartListening: false });
        
        // Fallback to keyword-based routing
        await fallbackKeywordRouting(userInput);
      } else {
        await speakWithoutListening("Sorry, I didn't understand that. Please try again.");
      }
    }
  }

  async function fallbackKeywordRouting(userInput: string) {
    // Simple keyword-based routing when AI is unavailable
    const navigationKeywords = ['navigate', 'go', 'take me', 'drive', 'directions', 'find', 'locate', 'show', 'search', 'where is', 'nearest'];
    const questionKeywords = ['what', 'how', 'why', 'when', 'who', 'weather', 'temperature', 'tell me', 'explain'];
    
    const hasNavigationKeyword = navigationKeywords.some(kw => userInput.toLowerCase().includes(kw));
    const hasQuestionKeyword = questionKeywords.some(kw => userInput.toLowerCase().includes(kw));
    
    if (hasNavigationKeyword || (!hasQuestionKeyword && userInput.split(' ').length <= 3)) {
      // Likely a navigation request
      console.log('🗺️ Fallback: Treating as navigation');
      setIsAIMode(false);
      setQuery(userInput);
      searchPlaces(userInput);
    } else {
      // Likely a question - use simpler AI response without routing decision
      console.log('💬 Fallback: Treating as question');
      setIsAIMode(true);
      setShowChatOverlay(true);
      
      try {
        // Try to get a simple answer without the routing overhead
        await getAIResponse(userInput);
      } catch (err) {
        // If even this fails, provide a generic response
        await speakWithoutListening("I'm sorry, I'm having trouble right now. Please try asking something else or restart the app.");
      }
    }
  }

  async function getAIResponse(message: string) {
    try {
      console.log('🤖 Getting AI response for:', message);
      
      // Check if the user is asking about weather
      const weatherKeywords = ['weather', 'temperature', 'forecast', 'hot', 'cold', 'rain', 'sunny', 'climate'];
      const isWeatherQuery = weatherKeywords.some(keyword => message.toLowerCase().includes(keyword));
      
      let weatherInfo = '';
      
      // If asking about weather, try to get weather data
      if (isWeatherQuery) {
        try {
          // Extract location from message (simple approach)
          const locationMatch = message.match(/in\s+([a-zA-Z\s]+)/i);
          const weatherLocation = locationMatch ? locationMatch[1].trim() : 
            (location ? `${location.coords.latitude},${location.coords.longitude}` : 'New York'); // Default to New York if no location
          
          console.log('🌤️ Fetching weather for:', weatherLocation);
          const weatherResponse = await fetch(
            `https://wttr.in/${encodeURIComponent(weatherLocation)}?format=j1`
          );
          
          if (weatherResponse.ok) {
            const data = await weatherResponse.json();
            const current = data.current_condition[0];
            const locationName = data.nearest_area?.[0]?.areaName?.[0]?.value || weatherLocation;
            
            // Create simple, direct weather response
            const tempC = current.temp_C;
            const tempF = current.temp_F;
            const condition = current.weatherDesc[0].value;
            const humidity = current.humidity;
            const windSpeed = current.windspeedKmph;
            const feelsLikeC = current.FeelsLikeC;
            const feelsLikeF = current.FeelsLikeF;
            
            // Just give the AI a direct weather summary to relay
            weatherInfo = `The current weather in ${locationName} is ${tempC}°C or ${tempF}°F. It's ${condition}. It feels like ${feelsLikeC}°C or ${feelsLikeF}°F. The humidity is ${humidity}% and wind speed is ${windSpeed} kilometers per hour.`;
            
            console.log('✅ Weather fetched:', weatherInfo);
            
            // For weather queries, just speak the weather directly and skip AI
            setChatHistory(prev => [
              ...prev,
              { role: 'user', text: message },
              { role: 'model', text: weatherInfo }
            ]);
            await speakWithoutListening(weatherInfo, { restartListening: false });
            
            // Reset and restart wake word listening
            setTimeout(() => {
              speakWithoutListening('Say Hey Cosmo if you need anything else.');
              setIsAIMode(false);
            }, weatherInfo.length * 60);
            
            return; // Exit early for weather queries
          }
        } catch (weatherError) {
          console.error('⚠️ Weather fetch error:', weatherError);
        }
      }
      
      // For non-weather queries, use AI
      // Build the conversation content
      let conversationContent = '';
      
      // Add conversation history
      for (const item of chatHistory) {
        if (item.role === 'user') {
          conversationContent += `user: ${item.text}\n`;
        } else {
          conversationContent += `model: ${item.text}\n`;
        }
      }
      
      // Add current message
      conversationContent += `user: ${message}\n`;
      
      // Make the API call
      console.log('🚀 Calling Gemini API...');
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash-lite",
        contents: conversationContent,
      });
      
      const text = response.text || '';
      if (text) {
        console.log('✅ AI response received');
        setChatHistory(prev => [...prev, { role: 'model', text }]);
        await speakWithoutListening(text, { restartListening: false });
        
        // Reset states after AI response
        setIsAIMode(false);
        
        // Restart wake word listening after AI speaks - with longer delay
        setTimeout(() => {
          speakWithoutListening('Say Hey Cosmo if you need anything else.');
        }, text.length * 50); // Estimate speech duration
      } else {
        throw new Error('No response text received from AI');
      }
    } catch (err) {
      console.error('❌ AI response error:', err);
      await speakWithoutListening("Sorry, I'm having trouble thinking right now.");
      
      // Reset states and restart wake word listening even on error
      setIsAIMode(false);
    }
  }
  
  async function handleWebViewMessage(event: any) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('Message from WebView:', data.type);
      
      if (data.type === 'autocompleteResults') {
        const results = data.predictions || [];
        setPredictions(results);
        setSearching(false);
      }
      else if (data.type === 'searchResults') {
        const results = data.results || [];
        console.log('Search results received:', results.length);
        setSearching(false);
        
        if (results.length === 0) {
          // Speech.speak('No results found');
          updateCandidates([]);
          return;
        }
        
        // Process results with distances
        const mapped = results.map((item: any) => {
          const lat = item.lat;
          const lng = item.lng;
          const d = metersBetween(location!.coords.latitude, location!.coords.longitude, lat, lng);
          
          return {
            label: item.name || 'Unknown location',
            address: item.address || '',
            coordinates: [lng, lat],
            distance: d,
            placeId: item.placeId,
            rating: item.rating || 0,
          };
        });
        
        // Sort by relevance (name match) first, then by distance
        const searchQuery = query.toLowerCase().trim();
        const sorted = mapped.sort((a: any, b: any) => {
          const aName = a.label.toLowerCase();
          const bName = b.label.toLowerCase();
          
          // Exact match comes first
          const aExactMatch = aName === searchQuery;
          const bExactMatch = bName === searchQuery;
          if (aExactMatch && !bExactMatch) return -1;
          if (!aExactMatch && bExactMatch) return 1;
          
          // Starts with query comes next
          const aStartsWith = aName.startsWith(searchQuery);
          const bStartsWith = bName.startsWith(searchQuery);
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
          
          // Contains query comes next
          const aContains = aName.includes(searchQuery);
          const bContains = bName.includes(searchQuery);
          if (aContains && !bContains) return -1;
          if (!aContains && bContains) return 1;
          
          // If both have same relevance, sort by distance
          return a.distance - b.distance;
        }).slice(0, 50); // Limit to 50 results
        
        updateCandidates(sorted);
        
        // Enable number selection mode BEFORE announcing (so it's ready immediately)
  updateAwaitingNumberSelection(true, 'handleWebViewMessage');
        setIsAIMode(false);
        console.log('✅ Number selection mode ENABLED - candidates:', sorted.length);
        
        // Announce the first 3 results
        console.log('🔊 Reading out first 3 results...');
        const top3 = mapped.slice(0, 3);
        
        if (top3.length > 0) {
          let announcement = `Found ${mapped.length} result${mapped.length !== 1 ? 's' : ''}. `;
          
          top3.forEach((result: any, index: number) => {
            const distText = result.distance < 1000 
              ? `${Math.round(result.distance)} meters`
              : `${(result.distance / 1000).toFixed(1)} kilometers`;
            
            announcement += `Option ${index + 1}: ${result.label}, ${distText} away. `;
          });
          
          announcement += 'Just say the number to select, or say Hey Cosmo, choose option 1.';
          console.log('📢 Announcement:', announcement);
          
          // Stop listening before speaking to prevent TTS from triggering STT
          await stopRealtimeStream();
          
          // Speak the announcement
          Speech.speak(announcement, {
            onDone: () => {
              console.log('🔇 Options announcement finished');
              // Enable active listening mode so user can respond without wake word
              // Keep it enabled for 30 seconds to give user time to respond
              activelyListeningRef.current = true;
              console.log('✅ Active listening enabled for option selection');
              
              setTimeout(() => {
                if (activelyListeningRef.current) {
                  console.log('⏰ Active listening timeout - returning to passive mode');
                  activelyListeningRef.current = false;
                }
              }, 30000); // 30 seconds
              
              // Restart listening after speech completes
              if (!shouldListenRef.current) {
                startWakeWordListening();
              }
            }
          });
        } else {
          // Speech.speak('No results found');
        }
      }
    } catch (err) {
      console.error('Error handling WebView message:', err);
      setSearching(false);
    }
  }
  
  function clearSearchResults() {
    Speech.stop();
    setQuery('');
    updateCandidates([]);
    setPredictions([]);
  updateAwaitingNumberSelection(false, 'clearSearchResults'); // Clear number selection mode
    activelyListeningRef.current = false; // Reset active listening mode
    setIsAIMode(false); // Reset to navigation mode
    // Clear place markers from map
    postToWebView({ type: 'places', places: [] });
  }

  async function fetchRouteTo(candidate: any) {
    if (!location) return;
    // Stop speech and clear results when selecting a destination
    Speech.stop();
    updateCandidates([]);
  updateAwaitingNumberSelection(false, 'fetchRouteTo'); // Clear number selection mode
    destinationRef.current = candidate; // Store destination for re-routing
    
    try {
      const [destLon, destLat] = candidate.coordinates;
      console.log('Fetching route from', [location.coords.longitude, location.coords.latitude], 'to', [destLon, destLat]);
      console.log('Travel mode:', travelMode);
      
      // Google Directions API with selected travel mode
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${location.coords.latitude},${location.coords.longitude}&destination=${destLat},${destLon}&mode=${travelMode}&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      console.log('Google Directions response status:', res.status);
      
      if (!res.ok) {
        const errText = await res.text();
        console.warn('Google Directions error response:', errText);
        Alert.alert('Routing failed', `Status ${res.status}: ${errText.substring(0, 200)}`);
        return;
      }
      
      const data = await res.json();
      console.log('Google Directions response status:', data.status);
      
      if (data.status === 'REQUEST_DENIED') {
        Alert.alert('API Error', 'Please check your Google Maps API key and ensure Directions API is enabled.');
        return;
      }
      
      if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
        console.warn('No routes in response:', data);
        Alert.alert('No route found', 'Google Directions returned no route. Try another destination.');
        return;
      }
      
      const route = data.routes[0];
      const leg = route.legs[0];
      
      // Decode polyline from overview_polyline
      const polyline = route.overview_polyline?.points;
      if (!polyline) {
        Alert.alert('No route geometry', 'Could not get route path.');
        return;
      }
      
      const coordinates = decodeGooglePolyline(polyline);
      
      // Build a feature for compatibility with existing code
      const feat = {
        geometry: { coordinates },
        properties: { 
          instructions: leg.steps || [],
          travelMode: travelMode
        }
      };
      updateRoute(feat);
      
      // Convert Google Directions steps to our format
      const steps = (leg.steps || []).map((step: any) => {
        // Google step format: {html_instructions, distance.value, duration.value, end_location, travel_mode, transit_details}
        const endLat = step.end_location?.lat;
        const endLng = step.end_location?.lng;
        const endCoord = (endLat && endLng) ? [endLng, endLat] : null;
        
        // Strip HTML tags from instructions
        let instruction = step.html_instructions?.replace(/<[^>]*>/g, '') || 'Continue';
        
        // Add transit-specific information
        if (travelMode === 'transit' && step.transit_details) {
          const transit = step.transit_details;
          const line = transit.line;
          const departureStop = transit.departure_stop?.name;
          const arrivalStop = transit.arrival_stop?.name;
          const vehicleType = line?.vehicle?.type || 'transit';
          const lineName = line?.short_name || line?.name;
          const headsign = transit.headsign;
          const departureTime = transit.departure_time?.text;
          const numStops = transit.num_stops;
          
          // Create detailed transit instruction
          if (vehicleType === 'BUS') {
            instruction = `Take bus ${lineName}`;
            if (headsign) {
              instruction += ` towards ${headsign}`;
            }
            instruction += ` from ${departureStop}`;
            if (departureTime) {
              instruction += `, departing at ${departureTime}`;
            }
            instruction += `. Ride for ${numStops || 'several'} stop${numStops !== 1 ? 's' : ''} to ${arrivalStop}`;
          } else if (vehicleType === 'SUBWAY' || vehicleType === 'TRAM' || vehicleType === 'RAIL') {
            instruction = `Take ${vehicleType.toLowerCase()} ${lineName}`;
            if (headsign) {
              instruction += ` towards ${headsign}`;
            }
            instruction += ` from ${departureStop}`;
            if (departureTime) {
              instruction += `, departing at ${departureTime}`;
            }
            instruction += `. Ride for ${numStops || 'several'} stop${numStops !== 1 ? 's' : ''} to ${arrivalStop}`;
          } else {
            instruction = `Take ${lineName || 'transit'} from ${departureStop} to ${arrivalStop}`;
            if (departureTime) {
              instruction += `, departing at ${departureTime}`;
            }
          }
        }
        
        return {
          instruction,
          distance: step.distance?.value || 0, // meters
          duration: step.duration?.value || 0, // seconds
          endCoord,
          travelMode: step.travel_mode,
          transitDetails: step.transit_details
        };
      });
      updateSteps(steps);
      
      // Send route geometry to map view
      try {
        if (webviewRef.current && feat.geometry && feat.geometry.coordinates) {
          const payload = JSON.stringify({ type: 'route', coords: feat.geometry.coordinates });
          webviewRef.current.postMessage(payload);
        }
      } catch (e) {
        // ignore
      }
      
      const distanceKm = (leg.distance?.value || 0) / 1000;
      const durationMin = Math.round((leg.duration?.value || 0) / 60);
      
      // Stop listening before announcing route to prevent TTS from triggering STT
      await stopRealtimeStream();
      
      // Build enhanced announcement for transit routes
      let modeText = travelMode === 'walking' ? 'walking' : 'public transit';
      let routeAnnouncement = `Route calculated using ${modeText}. ${distanceKm.toFixed(1)} kilometers, about ${durationMin} minutes.`;
      
      // Add transit summary if using public transit
      if (travelMode === 'transit') {
        const transitSteps = steps.filter((s: any) => s.transitDetails);
        if (transitSteps.length > 0) {
          routeAnnouncement += ` You will take ${transitSteps.length} transit vehicle${transitSteps.length !== 1 ? 's' : ''}: `;
          transitSteps.forEach((step: any, index: number) => {
            const transit = step.transitDetails;
            const lineName = transit.line?.short_name || transit.line?.name || 'transit';
            const vehicleType = transit.line?.vehicle?.type?.toLowerCase() || 'vehicle';
            routeAnnouncement += `${vehicleType} ${lineName}`;
            if (index < transitSteps.length - 1) {
              routeAnnouncement += ', then ';
            }
          });
          routeAnnouncement += '.';
        }
      }
      
      routeAnnouncement += ' Just say start to begin navigation, or say Hey Cosmo, start navigation, or tap the Start button.';
      
      Speech.speak(routeAnnouncement, {
        onDone: () => {
          console.log('🔇 Route announcement finished');
          
          // Restart wake word listening
          if (!shouldListenRef.current && !navigating) {
            console.log('🔄 Starting wake word listening for navigation command');
            startWakeWordListening();
          }
          
          // Enable active listening mode AFTER speech completes and listening restarts
          // This allows user to say "start" without wake word for 30 seconds
          setTimeout(() => {
            console.log('✅ Enabling active listening mode for navigation command');
            activelyListeningRef.current = true;
            setTimeout(() => {
              if (activelyListeningRef.current) {
                console.log('⏰ Active listening timeout after route announcement');
                activelyListeningRef.current = false;
              }
            }, 30000); // 30 seconds
          }, 500); // Small delay to ensure listening has restarted
        }
      });
    } catch (e) {
      console.warn(e);
      Alert.alert('Routing failed');
    }
  }

  async function startNavigation() {
    console.log('🚀 startNavigation called');
    console.log('🗺️ routeRef.current:', !!routeRef.current);
    console.log('📍 stepsRef.current.length:', stepsRef.current.length);
    console.log('📍 steps state length:', steps.length);
    
    if (!routeRef.current || stepsRef.current.length === 0) { 
      console.log('❌ No route or steps available');
      Alert.alert('No route ready'); 
      return; 
    }
    
    console.log('✅ Route and steps available, starting navigation');
    
    // Enable object detection when starting navigation
    setIsDetectionActive(true);
    console.log('📹 Camera object detection enabled');
    
    // Start wake word listening during navigation for stop command
    if (!isListening) {
      console.log('🎙️ Starting wake word listening for stop command');
      setTimeout(() => startWakeWordListening(), 500); // Reduced from 1000ms
    }
    
    // Disable active listening mode when starting navigation
    activelyListeningRef.current = false;
    
    updateNavigating(true);
    setCurrentStep(0);
    hasSpokenStepRef.current.clear(); // Reset spoken steps
    lastWrongWayAlertRef.current = 0; // Reset wrong way alerts
    wrongWayStartPosRef.current = null; // Reset wrong way tracking
    announcedHazardsRef.current.clear(); // Reset announced hazards
    const currentStepRef = { current: 0 } as any;
    
    // Stop listening temporarily during navigation announcement
    if (shouldListenRef.current) {
      await stopWakeWordListening();
    }
    
    Speech.speak('Starting navigation. I will warn you about crosswalks and hazards. Say Hey Cosmo, stop navigation at any time.', {
      onDone: () => {
        // Restart listening after announcement
        if (!shouldListenRef.current) {
          startWakeWordListening();
        }
      }
    });

    // start polling location every 2 seconds
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setLocation(loc);
      const idx = currentStepRef.current ?? currentStep;
      const currentSteps = stepsRef.current;
      
      if (idx >= currentSteps.length) {
        // Arrived at destination - stop navigation first, then announce
        await stopNavigation(true); // Pass true to indicate we reached destination
        return;
      }
      const step = currentSteps[idx];
      if (!step.endCoord) return;
      const [lon, lat] = step.endCoord;
      const dist = metersBetween(loc.coords.latitude, loc.coords.longitude, lat, lon);
      
      // Speak instruction only once when entering a new step
      if (!hasSpokenStepRef.current.has(idx)) {
        hasSpokenStepRef.current.add(idx);
        await speakDuringNavigation(step.instruction || 'Continue');
      }
      
      // Check for nearby hazards (crosswalks, traffic lights, etc.)
      const hazards = await fetchNearbyHazards(loc.coords.latitude, loc.coords.longitude, 30);
      for (const hazard of hazards) {
        // Only announce hazards within 15-30 meters ahead
        if (hazard.distance >= 15 && hazard.distance <= 30) {
          // Check if we've already announced this hazard
          if (!announcedHazardsRef.current.has(hazard.id)) {
            announcedHazardsRef.current.add(hazard.id);
            console.log(`⚠️ Hazard detected: ${hazard.description} at ${hazard.distance.toFixed(0)}m`);
            await speakDuringNavigation(`Caution: ${hazard.description} in ${hazard.distance.toFixed(0)} meters`);
            
            // Remove from announced set after 60 seconds in case user passes by and comes back
            setTimeout(() => {
              announcedHazardsRef.current.delete(hazard.id);
            }, 60000);
            
            break; // Only announce one hazard at a time
          }
        }
      }
      
      // Check if heading in the wrong direction (only if we have heading data)
      if (loc.coords.heading !== null && loc.coords.heading !== undefined && loc.coords.heading >= 0) {
        // Calculate bearing to destination
        const bearing = calculateBearing(loc.coords.latitude, loc.coords.longitude, lat, lon);
        const headingDiff = Math.abs(((bearing - loc.coords.heading + 540) % 360) - 180);
        
        // If heading difference > 90 degrees, we're going the wrong way
        if (headingDiff > 90 && dist > 20) {
          // Track where wrong-way movement started
          if (!wrongWayStartPosRef.current) {
            wrongWayStartPosRef.current = { lat: loc.coords.latitude, lon: loc.coords.longitude };
          } else {
            // Check if user has traveled 10m in the wrong direction
            const wrongWayDist = metersBetween(
              wrongWayStartPosRef.current.lat,
              wrongWayStartPosRef.current.lon,
              loc.coords.latitude,
              loc.coords.longitude
            );
            
            // Alert if traveled 10m+ in wrong direction and haven't alerted recently
            const now = Date.now();
            if (wrongWayDist >= 10 && (now - lastWrongWayAlertRef.current) > 10000) {
              lastWrongWayAlertRef.current = now;
              await speakDuringNavigation('You are going the wrong way. Turn around.');
              wrongWayStartPosRef.current = null; // Reset for next wrong-way detection
            }
          }
        } else {
          // Reset wrong-way tracking if heading is correct
          wrongWayStartPosRef.current = null;
        }
      }
      
      // Advance to next step when close enough
      if (dist <= 10) {
        currentStepRef.current = idx + 1;
        setCurrentStep(idx + 1);
      }
      
      // Off-route detection and re-routing
      const currentRoute = routeRef.current;
      const routeCoords: any[] = currentRoute?.geometry?.coordinates || [];
      let nearest = Infinity;
      for (let i = 0; i < routeCoords.length; i++) {
        const [rlon, rlat] = routeCoords[i];
        const d = metersBetween(loc.coords.latitude, loc.coords.longitude, rlat, rlon);
        if (d < nearest) nearest = d;
      }
      if (nearest > 30 && destinationRef.current) {
        await speakDuringNavigation('Off route. Recalculating');
        // Re-fetch route from current location to original destination
        stopNavigation(false); // Manual stop for recalculation
        await fetchRouteTo(destinationRef.current);
        // Restart navigation with new route
        setTimeout(() => startNavigation(), 1000);
      }
    }, 2000);
  }

  async function stopNavigation(reachedDestination = false) {
    // Prevent multiple calls - check if already stopped
    if (!navigatingRef.current) {
      console.log('⚠️ Navigation already stopped, ignoring');
      return;
    }
    
    console.log('🛑 Stopping navigation', reachedDestination ? '(arrived at destination)' : '(manual stop)');
    
    // Clear navigation state IMMEDIATELY at the start to prevent any race conditions
    updateNavigating(false);
    
    // Disable object detection when stopping navigation
    setIsDetectionActive(false);
    console.log('📹 Camera object detection disabled');
    
    // Stop any ongoing speech
    Speech.stop();
    
    // Stop location polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    
    // Clear other navigation state
    setCurrentStep(0);
    hasSpokenStepRef.current.clear();
    
    // Clear route data
    updateRoute(null);
    updateSteps([]);
    destinationRef.current = null;
    
    // Clear route from map and recenter on user location
    postToWebView({ type: 'route', coords: [] });
    
    // Reset voice states
    updateAwaitingNumberSelection(false, 'stopNavigation');
    setIsAIMode(false);
    activelyListeningRef.current = false;
    
    console.log('✅ Navigation stopped, map reset');
    
    // Announce appropriately based on how navigation ended
    if (!reachedDestination) {
      // Manual stop - announce "Navigation stopped"
      await speakWithoutListening('Navigation stopped', { restartListening: true });
    } else {
      // Reached destination - announce arrival AFTER stopping navigation to prevent feedback
      await speakWithoutListening('You have arrived at your destination', { restartListening: true });
    }
  }

  function repeatInstruction() {
    if (navigating && steps[currentStep]) {
      speakDuringNavigation(steps[currentStep].instruction || 'Continue');
      console.log('Repeat instruction:', steps[currentStep].instruction || 'Continue');
    }
  }

  return (
    <View style={styles.container}>
      {/* Full-screen map */}
      <WebView
        ref={webviewRef}
        originWhitelist={["*"]}
        style={StyleSheet.absoluteFillObject}
        onMessage={handleWebViewMessage}
        source={{ html: `
              <!doctype html>
              <html>
              <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <style>html,body,#map{height:100%;margin:0;padding:0}</style>
              </head>
              <body>
              <div id="map"></div>
              <script>
                let map, userMarker, routePolyline, placeMarkers = [];
                let placesService, autocompleteService;
                
                function initMap() {
                  map = new google.maps.Map(document.getElementById('map'), {
                    center: { lat: 0, lng: 0 },
                    zoom: 15,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    streetViewControl: false,
                    zoomControl: true,
                  });
                  
                  // Initialize Services
                  placesService = new google.maps.places.PlacesService(map);
                  autocompleteService = new google.maps.places.AutocompleteService();
                  
                  userMarker = new google.maps.Marker({
                    map: map,
                    title: 'You',
                    icon: {
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 10,
                      fillColor: '#4285F4',
                      fillOpacity: 1,
                      strokeColor: '#ffffff',
                      strokeWeight: 3,
                    }
                  });
                }

                function performAutocomplete(query, location) {
                  if (!autocompleteService) {
                    console.error('Autocomplete service not initialized');
                    return;
                  }
                  
                  const request = {
                    input: query,
                    location: new google.maps.LatLng(location.lat, location.lng),
                    radius: 50000,
                  };
                  
                  autocompleteService.getPlacePredictions(request, function(predictions, status) {
                    if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                      const formattedPredictions = predictions.slice(0, 5).map(pred => ({
                        description: pred.description,
                        placeId: pred.place_id,
                        mainText: pred.structured_formatting?.main_text || pred.description,
                        secondaryText: pred.structured_formatting?.secondary_text || '',
                      }));
                      
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'autocompleteResults',
                        predictions: formattedPredictions
                      }));
                    } else {
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'autocompleteResults',
                        predictions: []
                      }));
                    }
                  });
                }

                function performSearch(query, location) {
                  console.log('🔍 [WebView] performSearch called with query:', query, 'location:', location);
                  
                  if (!placesService) {
                    console.error('❌ [WebView] Places service not initialized');
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'searchResults',
                      results: []
                    }));
                    return;
                  }
                  
                  console.log('✅ [WebView] Places service is initialized, starting nearby search...');
                  
                  // Try nearby search first for better proximity results
                  const nearbyRequest = {
                    location: new google.maps.LatLng(location.lat, location.lng),
                    radius: 5000, // Start with 5km radius
                    keyword: query,
                  };
                  
                  console.log('📍 [WebView] Nearby search request:', nearbyRequest);
                  
                  placesService.nearbySearch(nearbyRequest, function(nearbyResults, nearbyStatus) {
                    console.log('📊 [WebView] Nearby search (5km) status:', nearbyStatus, 'results:', nearbyResults?.length || 0);
                    // If nearby search succeeds and has good results, use those
                    if (nearbyStatus === google.maps.places.PlacesServiceStatus.OK && nearbyResults && nearbyResults.length >= 3) {
                      console.log('✅ [WebView] Nearby search (5km) succeeded with', nearbyResults.length, 'results');
                      const formattedResults = nearbyResults.map(place => ({
                        name: place.name,
                        address: place.formatted_address || place.vicinity || '',
                        lat: place.geometry.location.lat(),
                        lng: place.geometry.location.lng(),
                        placeId: place.place_id,
                        rating: place.rating || 0,
                      }));
                      
                      console.log('📤 [WebView] Sending results to React Native:', formattedResults.length, 'results');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'searchResults',
                        results: formattedResults
                      }));
                      
                      setPlaces(formattedResults.map(r => ({
                        label: r.name,
                        coords: [r.lng, r.lat]
                      })));
                      return;
                    }
                    
                    // Try wider radius if we have few results
                    console.log('⚠️ [WebView] Nearby search (5km) returned few results, trying 15km radius');
                    const widerNearbyRequest = {
                      location: new google.maps.LatLng(location.lat, location.lng),
                      radius: 15000, // 15km radius
                      keyword: query,
                    };
                    
                    placesService.nearbySearch(widerNearbyRequest, function(widerResults, widerStatus) {
                      console.log('📊 [WebView] Nearby search (15km) status:', widerStatus, 'results:', widerResults?.length || 0);
                      
                      if (widerStatus === google.maps.places.PlacesServiceStatus.OK && widerResults && widerResults.length > 0) {
                        console.log('✅ [WebView] Nearby search (15km) succeeded with', widerResults.length, 'results');
                        const formattedResults = widerResults.map(place => ({
                          name: place.name,
                          address: place.formatted_address || place.vicinity || '',
                          lat: place.geometry.location.lat(),
                          lng: place.geometry.location.lng(),
                          placeId: place.place_id,
                          rating: place.rating || 0,
                        }));
                        
                        console.log('📤 [WebView] Sending wider results to React Native:', formattedResults.length, 'results');
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                          type: 'searchResults',
                          results: formattedResults
                        }));
                        
                        setPlaces(formattedResults.map(r => ({
                          label: r.name,
                          coords: [r.lng, r.lat]
                        })));
                        return;
                      }
                      
                      // Fallback to text search if nearby searches fail
                      console.log('⚠️ [WebView] Nearby searches failed - falling back to text search');
                      const textRequest = {
                        query: query,
                        location: new google.maps.LatLng(location.lat, location.lng),
                        radius: 50000, // 50km for text search
                      };
                      
                      console.log('📍 [WebView] Text search request:', textRequest);
                      
                      placesService.textSearch(textRequest, function(results, status) {
                        console.log('📊 [WebView] Text search status:', status, 'results:', results?.length || 0);
                        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                          const formattedResults = results.map(place => ({
                            name: place.name,
                            address: place.formatted_address || place.vicinity || '',
                            lat: place.geometry.location.lat(),
                            lng: place.geometry.location.lng(),
                            placeId: place.place_id,
                            rating: place.rating || 0,
                          }));
                          
                          console.log('📤 [WebView] Sending text search results to React Native:', formattedResults.length, 'results');
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'searchResults',
                            results: formattedResults
                          }));
                          
                          setPlaces(formattedResults.map(r => ({
                            label: r.name,
                            coords: [r.lng, r.lat]
                          })));
                        } else {
                          console.error('❌ [WebView] Text search failed:', status);
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'searchResults',
                            results: []
                          }));
                        }
                      });
                    });
                  });
                }

                function searchByPlaceId(placeId) {
                  if (!placesService) return;
                  
                  placesService.getDetails({ placeId: placeId }, function(place, status) {
                    if (status === google.maps.places.PlacesServiceStatus.OK && place) {
                      const result = {
                        name: place.name,
                        address: place.formatted_address || place.vicinity || '',
                        lat: place.geometry.location.lat(),
                        lng: place.geometry.location.lng(),
                        placeId: place.place_id,
                        rating: place.rating || 0,
                      };
                      
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'searchResults',
                        results: [result]
                      }));
                      
                      setPlaces([{
                        label: result.name,
                        coords: [result.lng, result.lat]
                      }]);
                    }
                  });
                }

                function updateLocation(coords, heading) {
                  const lat = coords[1];
                  const lng = coords[0];
                  
                  if (userMarker) {
                    userMarker.setPosition({ lat, lng });
                    
                    // Update icon rotation if heading is available
                    if (heading && heading >= 0) {
                      userMarker.setIcon({
                        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: 5,
                        fillColor: '#4285F4',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                        rotation: heading
                      });
                    }
                  }
                  
                  // Only recenter if no route is active
                  if (!routePolyline) {
                    map.setCenter({ lat, lng });
                  }
                }

                function drawRoute(coords) {
                  // Remove existing route
                  if (routePolyline) {
                    routePolyline.setMap(null);
                    routePolyline = null;
                  }
                  
                  // If no coords, just clear and recenter on user
                  if (!coords || coords.length === 0) {
                    console.log('🗺️ Clearing route, recentering on user');
                    if (userMarker && userMarker.getPosition()) {
                      map.setCenter(userMarker.getPosition());
                      map.setZoom(15);
                    }
                    return;
                  }
                  
                  // Draw the route
                  const path = coords.map(c => ({ lat: c[1], lng: c[0] }));
                  
                  routePolyline = new google.maps.Polyline({
                    path: path,
                    geodesic: true,
                    strokeColor: '#4285F4',
                    strokeOpacity: 1.0,
                    strokeWeight: 5,
                    map: map
                  });
                  
                  const bounds = new google.maps.LatLngBounds();
                  path.forEach(point => bounds.extend(point));
                  map.fitBounds(bounds, { padding: 50 });
                }

                function setPlaces(places) {
                  placeMarkers.forEach(m => m.setMap(null));
                  placeMarkers = [];
                  
                  if (places.length === 0) return;
                  
                  const bounds = new google.maps.LatLngBounds();
                  
                  places.forEach(p => {
                    const lat = p.coords[1];
                    const lng = p.coords[0];
                    const marker = new google.maps.Marker({
                      position: { lat, lng },
                      map: map,
                      title: p.label || '',
                      icon: {
                        url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
                      }
                    });
                    placeMarkers.push(marker);
                    bounds.extend({ lat, lng });
                  });
                  
                  // Include user marker in bounds
                  if (userMarker) {
                    bounds.extend(userMarker.getPosition());
                  }
                  
                  map.fitBounds(bounds, { padding: 100 });
                }

                function handleMessage(data) {
                  console.log('📨 [WebView] handleMessage received:', data?.type, data);
                  if (!data || !data.type) {
                    console.log('⚠️ [WebView] Invalid message data');
                    return;
                  }
                  try {
                    if (data.type === 'route') {
                      console.log('🗺️ [WebView] Drawing route');
                      drawRoute(data.coords || []);
                    }
                    else if (data.type === 'updateLocation') {
                      console.log('📍 [WebView] Updating location');
                      updateLocation(data.coords || [0,0], data.heading);
                    }
                    else if (data.type === 'places') {
                      console.log('📌 [WebView] Setting places');
                      setPlaces(data.places || []);
                    }
                    else if (data.type === 'autocomplete') {
                      console.log('🔤 [WebView] Performing autocomplete');
                      performAutocomplete(data.query, data.location);
                    }
                    else if (data.type === 'search') {
                      console.log('🔍 [WebView] Performing search for:', data.query);
                      performSearch(data.query, data.location);
                    }
                    else if (data.type === 'searchByPlaceId') {
                      console.log('🆔 [WebView] Searching by place ID');
                      searchByPlaceId(data.placeId);
                    }
                  } catch (err) {
                    console.error('❌ [WebView] Error in handleMessage:', err);
                  }
                }

                document.addEventListener('message', function(e) {
                  try { handleMessage(JSON.parse(e.data)); } catch (err) { console.error(err); }
                });
                window.addEventListener('message', function(e) {
                  try { handleMessage(JSON.parse(e.data)); } catch (err) { console.error(err); }
                });
                
                window.initMap = initMap;
              </script>
              <script src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=initMap" async defer></script>
              </body>
              </html>
            ` }}
          javaScriptEnabled
        />

      {/* Floating search bar and results overlay */}
      <View style={[styles.searchContainer, { top: insets.top + 54 }]}>
        {/* Location loading indicator */}
        {locationLoading && (
          <View style={styles.locationLoadingIndicator}>
            <Text style={styles.locationLoadingText}>📍 Getting your location...</Text>
          </View>
        )}
        
        {/* Travel Mode Selector */}
        <View style={styles.travelModeContainer}>
          <TouchableOpacity 
            style={[styles.modeButton, travelMode === 'walking' && styles.modeButtonActive]}
            onPress={() => setTravelMode('walking')}
          >
            <Text style={[styles.modeEmoji, travelMode === 'walking' && styles.modeEmojiActive]}>🚶</Text>
            <Text style={[styles.modeText, travelMode === 'walking' && styles.modeTextActive]}>Walk</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.modeButton, travelMode === 'transit' && styles.modeButtonActive]}
            onPress={() => setTravelMode('transit')}
          >
            <Text style={[styles.modeEmoji, travelMode === 'transit' && styles.modeEmojiActive]}>🚇</Text>
            <Text style={[styles.modeText, travelMode === 'transit' && styles.modeTextActive]}>Transit</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.searchBar}>
          <TextInput 
            value={query} 
            onChangeText={handleQueryChange} 
            onSubmitEditing={() => searchPlaces()}
            returnKeyType="search"
            style={styles.searchInput} 
            placeholder="Search places or say 'Cosmo'..." 
            placeholderTextColor="#999" 
          />
          <TouchableOpacity style={styles.searchButton} onPress={() => searchPlaces()}>
            <Text style={styles.searchButtonText}>{searching ? '...' : '🔍'}</Text>
          </TouchableOpacity>
          {(candidates.length > 0 || predictions.length > 0) && (
            <TouchableOpacity style={styles.closeButton} onPress={clearSearchResults}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Quick category buttons */}
        {!query && candidates.length === 0 && (
          <View style={styles.quickCategories}>
            <TouchableOpacity style={styles.categoryButton} onPress={() => searchCategory('restaurants')}>
              <Text style={styles.categoryEmoji}>🍽️</Text>
              <Text style={styles.categoryText}>Restaurants</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.categoryButton} onPress={() => searchCategory('cafes')}>
              <Text style={styles.categoryEmoji}>☕</Text>
              <Text style={styles.categoryText}>Cafes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.categoryButton} onPress={() => searchCategory('libraries')}>
              <Text style={styles.categoryEmoji}>📚</Text>
              <Text style={styles.categoryText}>Libraries</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.categoryButton} onPress={() => searchCategory('hospitals')}>
              <Text style={styles.categoryEmoji}>🏥</Text>
              <Text style={styles.categoryText}>Hospitals</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Autocomplete predictions */}
        {predictions.length > 0 && (
          <FlatList 
            data={predictions} 
            keyExtractor={(item, idx) => idx.toString()} 
            style={styles.resultsList}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.predictionItem} 
                onPress={() => {
                  setQuery(item.description);
                  postToWebView({ type: 'searchByPlaceId', placeId: item.placeId });
                  setPredictions([]);
                }}
              >
                <Text style={styles.predictionIcon}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.predictionMainText}>{item.mainText}</Text>
                  {item.secondaryText && (
                    <Text style={styles.predictionSecondaryText}>{item.secondaryText}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Search results */}
        {candidates.length > 0 && predictions.length === 0 && (
          <FlatList 
            data={candidates} 
            keyExtractor={(item, idx) => idx.toString()} 
            style={styles.resultsList}
            renderItem={({ item }) => {
              const distText = item.distance < 1000 
                ? `${Math.round(item.distance)}m`
                : `${(item.distance / 1000).toFixed(1)}km`;
              return (
                <TouchableOpacity style={styles.resultItem} onPress={() => fetchRouteTo(item)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultText} numberOfLines={1}>{item.label}</Text>
                    {item.address && (
                      <Text style={styles.resultAddress} numberOfLines={1}>{item.address}</Text>
                    )}
                  </View>
                  <View style={styles.resultMeta}>
                    {item.rating > 0 && (
                      <Text style={styles.ratingText}>⭐ {item.rating.toFixed(1)}</Text>
                    )}
                    <Text style={styles.distanceText}>{distText}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      {/* Camera view overlay during navigation */}
      {navigating && cameraPermission?.granted && (
        <View style={isCameraFullscreen ? styles.cameraFullscreen : styles.cameraContainer}>
          <CameraView 
            style={styles.camera} 
            ref={cameraRef}
            facing="back"
          />
          
          {/* Fullscreen toggle button */}
          <TouchableOpacity 
            style={[
              styles.cameraToggleButton,
              isCameraFullscreen && styles.cameraToggleButtonFullscreen
            ]}
            onPress={() => setIsCameraFullscreen(!isCameraFullscreen)}
          >
            <Text style={styles.cameraToggleText}>
              {isCameraFullscreen ? 'Minimize 🔽' : '🔼'}
            </Text>
          </TouchableOpacity>
          
          {/* Bounding boxes for detected objects */}
          <View style={styles.cameraOverlay}>
            {detectedObjects.map((obj, index) => {
              // Scale bounding boxes based on camera view size
              const scale = isCameraFullscreen ? 1 : 0.25; // Small view is 1/4 size
              return (
                <View
                  key={index}
                  style={[
                    styles.boundingBox,
                    {
                      left: obj.bbox[0] * scale,
                      top: obj.bbox[1] * scale,
                      width: obj.bbox[2] * scale,
                      height: obj.bbox[3] * scale,
                      borderColor: obj.color || '#FF6B6B',
                      borderWidth: isCameraFullscreen ? 3 : 2,
                    },
                  ]}
                >
                  <View style={[styles.labelContainer, { backgroundColor: obj.color || '#FF6B6B' }]}>
                    <Text style={[styles.labelText, isCameraFullscreen && { fontSize: 14 }]}>
                      {obj.label} {Math.round(obj.confidence * 100)}%
                    </Text>
                  </View>
                </View>
              );
            })}
            
            {/* Processing indicator */}
            {isProcessingFrame && (
              <View style={styles.processingIndicator}>
                <ActivityIndicator color="#4ECDC4" size={isCameraFullscreen ? "large" : "small"} />
                <Text style={[styles.processingText, isCameraFullscreen && { fontSize: 16 }]}>Scanning...</Text>
              </View>
            )}
            
            {/* Detection count */}
            {detectedObjects.length > 0 && (
              <View style={styles.detectionCount}>
                <Text style={[styles.countText, isCameraFullscreen && { fontSize: 16 }]}>
                  {detectedObjects.length} obstacle{detectedObjects.length !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Navigation controls overlay */}
      {route && !isCameraFullscreen && (
        <View style={styles.navControls}>
          {!navigating ? (
            <TouchableOpacity style={styles.navButton} onPress={startNavigation}>
              <Text style={styles.navButtonText}>Start Navigation</Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity 
                  style={[styles.navButton, styles.stopButton, { flex: 1 }]} 
                  onPress={() => stopNavigation(false)}
                >
                  <Text style={styles.navButtonText}>Stop</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.navButton, { flex: 1 }]} 
                  onPress={repeatInstruction}
                >
                  <Text style={styles.navButtonText}>Repeat</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.stepText}>
                Step {currentStep + 1}/{steps.length}: {steps[currentStep]?.instruction || ''}
              </Text>
              {/* Show transit details if available */}
              {steps[currentStep]?.transitDetails && (
                <View style={styles.transitDetailsContainer}>
                  {/* Transit Line/Route Number */}
                  {steps[currentStep].transitDetails.line?.short_name && (
                    <Text style={[styles.transitDetailText, styles.transitLineNumber]}>
                      🚌 {steps[currentStep].transitDetails.line.vehicle?.type || 'Route'} {steps[currentStep].transitDetails.line.short_name}
                      {steps[currentStep].transitDetails.headsign && ` → ${steps[currentStep].transitDetails.headsign}`}
                    </Text>
                  )}
                  
                  {/* Departure Stop */}
                  <Text style={styles.transitDetailText}>
                    🚏 From: {steps[currentStep].transitDetails.departure_stop?.name}
                  </Text>
                  
                  {/* Departure Time */}
                  {steps[currentStep].transitDetails.departure_time?.text && (
                    <Text style={styles.transitDetailText}>
                      ⏰ Departs: {steps[currentStep].transitDetails.departure_time.text}
                    </Text>
                  )}
                  
                  {/* Arrival Stop */}
                  {steps[currentStep].transitDetails.arrival_stop?.name && (
                    <Text style={styles.transitDetailText}>
                      📍 To: {steps[currentStep].transitDetails.arrival_stop.name}
                    </Text>
                  )}
                  
                  {/* Arrival Time */}
                  {steps[currentStep].transitDetails.arrival_time?.text && (
                    <Text style={styles.transitDetailText}>
                      🕐 Arrives: {steps[currentStep].transitDetails.arrival_time.text}
                    </Text>
                  )}
                  
                  {/* Number of Stops */}
                  {steps[currentStep].transitDetails.num_stops !== undefined && (
                    <Text style={styles.transitDetailText}>
                      🛑 {steps[currentStep].transitDetails.num_stops} stop{steps[currentStep].transitDetails.num_stops !== 1 ? 's' : ''}
                    </Text>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* AI Chat Overlay - Now always visible */}
      {chatHistory.length > 0 && (
        <View style={styles.chatOverlay}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatHeaderText}>💬 Chat History</Text>
            <TouchableOpacity 
              style={styles.chatCloseButton}
              onPress={() => {
                Speech.stop();
                setChatHistory([]);
              }}
            >
              <Text style={styles.chatCloseText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.chatMessages} contentContainerStyle={{ paddingBottom: 8 }}>
            {chatHistory.map((msg, index) => (
              <View 
                key={index}
                style={[
                  styles.chatBubble,
                  msg.role === 'user' ? styles.userBubble : styles.aiBubble
                ]}
              >
                <Text style={[
                  styles.chatText,
                  msg.role === 'user' ? styles.userText : styles.aiText
                ]}>
                  {msg.text}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Voice Status Indicator */}
      {(isListening || isRecording || isAIMode || (!isListening && !isRecording && !navigating)) && (
        <View style={[styles.voiceStatusIndicator, { top: insets.top + 8 }]}>
          <View style={[
            styles.statusDot,
            isRecording ? styles.recordingDot : 
            isAIMode ? styles.aiDot : 
            isListening ? styles.listeningDot :
            styles.inactiveDot
          ]} />
          <Text style={styles.voiceStatusText}>
            {isRecording ? '🔴 Recording... (pause 3s to send)' :
             isAIMode ? '🤖 AI thinking...' :
             isListening ? '👂 Listening for "Hey Cosmo"' :
             '⚠️ Voice inactive'}
          </Text>
          {!isListening && !isRecording && !isAIMode && (
            <TouchableOpacity 
              style={styles.restartVoiceButton}
              onPress={() => startWakeWordListening()}
            >
              <Text style={styles.restartVoiceButtonText}>Restart</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  searchContainer: { position: 'absolute', left: 12, right: 12, zIndex: 10 },
  
  locationLoadingIndicator: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width:0, height:2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  locationLoadingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Travel Mode Selector Styles
  travelModeContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 8,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: {width:0, height:2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    gap: 4,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#F0F0F0',
    gap: 6,
  },
  modeButtonActive: {
    backgroundColor: '#007AFF',
  },
  modeEmoji: {
    fontSize: 18,
  },
  modeEmojiActive: {
    // Could add a filter or brightness adjustment if needed
  },
  modeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  modeTextActive: {
    color: '#fff',
  },
  
  recordingIndicator: {
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width:0, height:2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  recordingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  
  searchBar: { 
    flexDirection: 'row', 
    backgroundColor: '#fff', 
    borderRadius: 8, 
    shadowColor: '#000', 
    shadowOffset: {width:0, height:2}, 
    shadowOpacity: 0.2, 
    shadowRadius: 4, 
    elevation: 4, 
    paddingHorizontal: 12, 
    paddingVertical: 8,
    alignItems: 'center'
  },
  searchInput: { flex: 1, fontSize: 16, paddingHorizontal: 8, paddingVertical: 4 },
  searchButton: { 
    backgroundColor: '#007AFF', 
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 6, 
    justifyContent: 'center',
    minWidth: 40
  },
  searchButtonText: { color: '#fff', fontWeight: '600', fontSize: 16, textAlign: 'center' },
  voiceButton: { 
    backgroundColor: '#34C759', 
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 6, 
    justifyContent: 'center',
    minWidth: 40,
    marginLeft: 6
  },
  voiceButtonActive: {
    backgroundColor: '#FF3B30',
  },
  voiceButtonListening: {
    backgroundColor: '#FF9500',
  },
  voiceButtonText: { color: '#fff', fontWeight: '600', fontSize: 16, textAlign: 'center' },
  closeButton: { 
    backgroundColor: '#FF3B30', 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 6, 
    justifyContent: 'center', 
    marginLeft: 6 
  },
  closeButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  
  quickCategories: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 8,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: {width:0, height:2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    gap: 8,
  },
  categoryButton: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
  },
  categoryEmoji: { fontSize: 24, marginBottom: 4 },
  categoryText: { fontSize: 11, color: '#333', fontWeight: '600' },
  
  resultsList: { 
    maxHeight: 400, 
    backgroundColor: '#fff', 
    borderRadius: 8, 
    marginTop: 8, 
    shadowColor: '#000', 
    shadowOffset: {width:0, height:2}, 
    shadowOpacity: 0.2, 
    shadowRadius: 4, 
    elevation: 4 
  },
  
  predictionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
  },
  predictionIcon: { fontSize: 18, marginRight: 12 },
  predictionMainText: { fontSize: 15, fontWeight: '500', color: '#000' },
  predictionSecondaryText: { fontSize: 13, color: '#666', marginTop: 2 },
  
  resultItem: { 
    padding: 14, 
    borderBottomWidth: 1, 
    borderBottomColor: '#eee', 
    flexDirection: 'row', 
    alignItems: 'center',
    gap: 12
  },
  resultText: { fontSize: 15, fontWeight: '500', color: '#000' },
  resultAddress: { fontSize: 13, color: '#666', marginTop: 2 },
  resultMeta: { alignItems: 'flex-end' },
  ratingText: { fontSize: 12, color: '#666', marginBottom: 4 },
  distanceText: { fontSize: 13, color: '#007AFF', fontWeight: '600' },
  
  navControls: { 
    position: 'absolute', 
    bottom: 24, 
    left: 16, 
    right: 16, 
    zIndex: 10, 
    backgroundColor: '#fff', 
    borderRadius: 12, 
    padding: 16, 
    shadowColor: '#000', 
    shadowOffset: {width:0, height:4}, 
    shadowOpacity: 0.3, 
    shadowRadius: 8, 
    elevation: 8 
  },
  navButton: { backgroundColor: '#34C759', paddingVertical: 16, borderRadius: 8, alignItems: 'center' },
  navButtonActive: { backgroundColor: '#FF9500' },
  stopButton: { backgroundColor: '#FF3B30' },
  navButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  stepText: { marginTop: 12, textAlign: 'center', fontSize: 14, color: '#333', lineHeight: 20 },
  
  // Transit Details Styles
  transitDetailsContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  transitDetailText: {
    fontSize: 13,
    color: '#333',
    marginBottom: 4,
    fontWeight: '500',
  },
  transitLineNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 8,
  },
  
  // Chat Overlay Styles - Redesigned as permanent sidebar
  chatOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 250,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -4},
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 100,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  chatHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  chatCloseButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FF3B30',
    borderRadius: 6,
  },
  chatCloseText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  chatMessages: {
    padding: 12,
    flex: 1,
  },
  chatBubble: {
    padding: 10,
    borderRadius: 12,
    marginBottom: 8,
    maxWidth: '90%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#E9ECEF',
  },
  chatText: {
    fontSize: 14,
    lineHeight: 18,
  },
  userText: {
    color: '#FFFFFF',
  },
  aiText: {
    color: '#000000',
  },
  
  // Voice Status Indicator
  voiceStatusIndicator: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 99,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  listeningDot: {
    backgroundColor: '#34C759',
  },
  recordingDot: {
    backgroundColor: '#FF3B30',
  },
  aiDot: {
    backgroundColor: '#007AFF',
  },
  inactiveDot: {
    backgroundColor: '#999999',
  },
  voiceStatusText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  restartVoiceButton: {
    backgroundColor: '#34C759',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  restartVoiceButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  
  // Camera and object detection styles
  cameraContainer: {
    position: 'absolute',
    bottom: 200, // Moved higher to avoid navigation buttons
    right: 12, // Changed from left to right
    width: 160,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#4ECDC4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  cameraFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 100, // Ensure it's on top of everything
  },
  cameraToggleButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 101,
  },
  cameraToggleButtonFullscreen: {
    top: 'auto',
    bottom: 24,
    right: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  cameraToggleText: {
    color: '#4ECDC4',
    fontSize: 16,
    fontWeight: 'bold',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  boundingBox: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'solid',
  },
  labelContainer: {
    position: 'absolute',
    top: -22,
    left: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  labelText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  processingIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 12,
  },
  processingText: {
    color: '#4ECDC4',
    marginLeft: 4,
    fontSize: 10,
    fontWeight: '600',
  },
  detectionCount: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 12,
  },
  countText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
});

