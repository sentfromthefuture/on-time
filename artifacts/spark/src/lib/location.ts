import { supabase } from '@/lib/supabase';

export type Coords = { lat: number; lng: number };

export const LUSAKA: Coords = { lat: -15.4167, lng: 28.2833 };

const geolocationReason = (code: number) => {
  if (code === 1) return 'Location permission was denied.';
  if (code === 2) return 'Your position could not be determined.';
  if (code === 3) return 'The location request timed out.';
  return 'Your location is unavailable.';
};

/** Resolves with the device position, or rejects with a readable Error. */
export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('This browser does not support location services.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      (error) => {
        const reason = geolocationReason(error.code);
        reject(new Error(error.message ? `${reason} (${error.message})` : reason));
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 60_000 },
    );
  });
}

/** Saves a position to the user's profile. Throws the real Supabase error message on failure. */
export async function saveLocation(coords: Coords): Promise<void> {
  const { error } = await supabase.rpc('update_my_location', { p_lat: coords.lat, p_lng: coords.lng });
  if (error) throw new Error(`Could not save your location: ${error.message}`);
}

/** Reads the device position and saves it. Never used for routing decisions. */
export async function syncLocation(): Promise<void> {
  await saveLocation(await getPosition());
}
