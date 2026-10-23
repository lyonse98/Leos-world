import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { Position } from '../hooks/useGeolocation';

interface MapComponentProps {
  currentPosition: Position | null;
  destination: google.maps.LatLngLiteral | null;
  onDestinationSelect: (place: google.maps.places.PlaceResult) => void;
  onRouteCalculated?: (path: google.maps.LatLng[]) => void;
  queuedLandmarks?: Array<{ lat: number; lng: number; name: string; told: boolean }>;
}

export const MapComponent = ({ currentPosition, destination, onDestinationSelect, onRouteCalculated, queuedLandmarks }: MapComponentProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const destinationMarkerRef = useRef<google.maps.Marker | null>(null);
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);
  const pulseCircleRef = useRef<google.maps.Circle | null>(null);
  const landmarkMarkersRef = useRef<google.maps.Marker[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initMap = async () => {
      if (!mapRef.current) return;
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

      if (!apiKey || apiKey === 'your_google_maps_api_key_here' || apiKey.length < 30) {
        setError('Google Maps API Key is invalid or incomplete. Please check VITE_GOOGLE_MAPS_API_KEY in your .env file. A valid key should be 39 characters long.');
        return;
      }

      try {
        setOptions({
          key: apiKey,
          v: "weekly",
          libraries: ["places", "geometry"]
        });

        const { Map } = await importLibrary('maps');
        const { Autocomplete } = await importLibrary('places');

        mapInstanceRef.current = new Map(mapRef.current, {
          center: { lat: 37.7749, lng: -122.4194 },
          zoom: 15,
          mapId: 'CHAD_WORLD_MAP',
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        if (inputRef.current) {
          const autocomplete = new Autocomplete(inputRef.current, {
            fields: ['geometry', 'name', 'formatted_address'],
          });
          autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place?.geometry?.location) onDestinationSelect(place);
          });
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';

        if (errorMessage.includes('ApiNotActivatedMapError')) {
          setError('API Key Invalid: Google Maps API is not activated. Enable it in Google Cloud Console.');
        } else if (errorMessage.includes('RefererNotAllowedMapError')) {
          setError('API Key Invalid: This domain is not authorized. Check API key restrictions.');
        } else if (errorMessage.includes('ApiTargetBlockedMapError')) {
          setError('Billing Not Enabled: Enable billing in Google Cloud Console.');
        } else {
          setError(`Google Maps Error: ${errorMessage}`);
        }
        console.error('Map initialization error:', err);
      }
    };
    initMap();
  }, [onDestinationSelect]);

  useEffect(() => {
    if (!mapInstanceRef.current || !currentPosition) return;

    const position = { lat: currentPosition.lat, lng: currentPosition.lng };

    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({
        position,
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#00D9FF',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        title: 'Your Location',
        zIndex: 1000,
      });

      pulseCircleRef.current = new google.maps.Circle({
        center: position,
        radius: currentPosition.accuracy || 50,
        map: mapInstanceRef.current,
        fillColor: '#00D9FF',
        fillOpacity: 0.15,
        strokeColor: '#00D9FF',
        strokeOpacity: 0.4,
        strokeWeight: 2,
        zIndex: 999,
      });

      let pulseGrowing = true;
      let currentRadius = currentPosition.accuracy || 50;
      const baseRadius = currentPosition.accuracy || 50;
      setInterval(() => {
        if (pulseGrowing) {
          currentRadius += 2;
          if (currentRadius >= baseRadius * 1.5) pulseGrowing = false;
        } else {
          currentRadius -= 2;
          if (currentRadius <= baseRadius) pulseGrowing = true;
        }
        pulseCircleRef.current?.setRadius(currentRadius);
      }, 50);

      mapInstanceRef.current.setCenter(position);
    } else {
      markerRef.current.setPosition(position);
      pulseCircleRef.current?.setCenter(position);
      pulseCircleRef.current?.setRadius(currentPosition.accuracy || 50);
    }
  }, [currentPosition]);

  useEffect(() => {
    if (!mapInstanceRef.current || !destination || !currentPosition) return;

    if (destinationMarkerRef.current) {
      destinationMarkerRef.current.setMap(null);
    }

    destinationMarkerRef.current = new google.maps.Marker({
      position: destination,
      map: mapInstanceRef.current,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: '#FF0080',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      },
      title: 'Destination',
    });

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: currentPosition.lat, lng: currentPosition.lng });
    bounds.extend(destination);
    mapInstanceRef.current.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });

    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
    }

    const directionsService = new google.maps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: currentPosition.lat, lng: currentPosition.lng },
        destination: destination,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          const path = result.routes[0].overview_path;
          routePolylineRef.current = new google.maps.Polyline({
            path: path,
            geodesic: true,
            strokeColor: '#00D9FF',
            strokeOpacity: 0.8,
            strokeWeight: 4,
            map: mapInstanceRef.current,
          });

          if (onRouteCalculated) {
            onRouteCalculated(path);
          }
        }
      }
    );
  }, [destination, currentPosition, onRouteCalculated]);

  useEffect(() => {
    if (!mapInstanceRef.current || !queuedLandmarks) return;

    landmarkMarkersRef.current.forEach(marker => marker.setMap(null));
    landmarkMarkersRef.current = [];

    queuedLandmarks.forEach((landmark) => {
      const marker = new google.maps.Marker({
        position: { lat: landmark.lat, lng: landmark.lng },
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: landmark.told ? '#888888' : '#FFD700',
          fillOpacity: landmark.told ? 0.5 : 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        title: landmark.name,
        zIndex: 500,
      });

      landmarkMarkersRef.current.push(marker);
    });
  }, [queuedLandmarks]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-red-900 border-4 border-red-500">
        <div className="text-white text-center p-6">
          <div className="text-2xl font-bold mb-4">MAP ERROR</div>
          <div className="text-lg font-mono bg-black bg-opacity-50 p-4 rounded">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-4 left-4 right-4 z-10">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search destination..."
          className="w-full px-4 py-3 bg-gray-900 text-white border-2 border-cyan-500 rounded-lg focus:outline-none focus:border-cyan-300 text-lg"
        />
      </div>
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};