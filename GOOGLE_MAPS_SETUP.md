# Google Maps API Setup Instructions

Your app has been converted to use Google Maps APIs. Follow these steps to get it working:

## 1. Get a Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Go to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **API Key**
5. Copy your API key

## 2. Enable Required APIs

In the Google Cloud Console, go to **APIs & Services** > **Library** and enable:

- ✅ **Maps JavaScript API** (for map display)
- ✅ **Places API** (for place search)
- ✅ **Directions API** (for routing/navigation)
- ✅ **Geocoding API** (optional, for address lookup)

## 3. Add API Key to Your App

Open `app/(tabs)/nav-prototype.tsx` and replace this line:

```typescript
const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY';
```

With your actual API key:

```typescript
const GOOGLE_MAPS_API_KEY = 'AIzaSyC...your-actual-key';
```

## 4. Important Security Notes

### For Production:
- **Restrict your API key** in Google Cloud Console:
  - Go to Credentials > Your API Key > Key restrictions
  - Set Application restrictions (iOS/Android app restrictions)
  - Set API restrictions (only allow the APIs you need)

### For Development:
- Your key can work unrestricted for testing
- Monitor usage in Google Cloud Console to avoid unexpected charges

## 5. API Usage & Billing

- Google Maps Platform has a **$200 monthly free credit**
- After that, you pay per request
- Typical costs:
  - Places API: $17 per 1,000 requests (Text Search)
  - Directions API: $5 per 1,000 requests
  - Maps JavaScript API: $7 per 1,000 loads
  
Set up billing alerts in Google Cloud Console to avoid surprises!

## 6. Testing

After adding your API key:

1. Restart your Expo development server
2. Test searching for "library" or "restaurant"
3. Select a result to get directions
4. Start navigation

## Troubleshooting

### "REQUEST_DENIED" Error
- Check that all required APIs are enabled
- Verify your API key is correct
- Check API key restrictions aren't blocking requests

### No Results Found
- Ensure Places API is enabled
- Check your internet connection
- Verify location permissions are granted

### No Route Found
- Ensure Directions API is enabled
- Check that start and end locations are valid
- Verify walking directions are available

## What Changed

The app now uses:
- **Google Maps** instead of OpenStreetMap/Leaflet for map display
- **Google Places API** instead of Nominatim for search
- **Google Directions API** instead of GraphHopper for routing

Benefits:
- ✅ Better search results and place data
- ✅ More reliable routing
- ✅ Better POI information (ratings, photos, etc.)
- ✅ More accurate walking directions
- ✅ Works globally with high quality data
