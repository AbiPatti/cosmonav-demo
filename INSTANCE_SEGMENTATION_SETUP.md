# Instance Segmentation Setup Guide

## Overview
Real-time instance segmentation has been implemented on the home page. The app now captures camera frames and sends them to your segmentation API for object detection.

## Configuration

### 1. Add API Configuration to `.env`

Add the following lines to your `.env` file:

```bash
# Instance Segmentation API
EXPO_PUBLIC_SEGMENTATION_API_URL=YOUR_API_ENDPOINT_URL
EXPO_PUBLIC_SEGMENTATION_API_KEY=YOUR_API_KEY
```

Replace:
- `YOUR_API_ENDPOINT_URL` with your actual instance segmentation API endpoint
- `YOUR_API_KEY` with your API authentication key

### 2. API Response Format

The implementation expects your API to return a response in this format:

```json
{
  "detections": [
    {
      "label": "person",
      "confidence": 0.95,
      "bbox": [100, 150, 200, 300]
    },
    {
      "label": "car",
      "confidence": 0.88,
      "bbox": [50, 200, 150, 250]
    }
  ]
}
```

Where:
- `label`: The detected object class name
- `confidence`: Confidence score (0-1)
- `bbox`: Bounding box as [x, y, width, height] in pixels

### 3. Customize API Integration

If your API has a different format, edit `app/(tabs)/index.tsx`:

#### Request Format
Update the fetch body in the `processFrame` function (around line 68):

```typescript
body: JSON.stringify({
  image: photo.base64,
  // Add your API's specific parameters here
  threshold: 0.5,
  model: 'your-model-name',
}),
```

#### Response Parsing
Update the response parser (around line 86):

```typescript
const objects: DetectedObject[] = data.your_response_key.map((obj: any, index: number) => ({
  label: obj.your_label_field,
  confidence: obj.your_confidence_field,
  bbox: obj.your_bbox_field, // Should be [x, y, width, height]
  color: generateColor(index),
}));
```

## Performance Optimization

### Adjust Processing Speed

The app processes frames every 500ms by default. To adjust:

In `app/(tabs)/index.tsx`, find this line (around line 109):

```typescript
}, 500); // Adjust this value
```

- **Faster detection**: Lower value (e.g., 300ms) - more API calls, higher cost
- **Slower detection**: Higher value (e.g., 1000ms) - fewer API calls, lower cost
- **Balance**: 500-800ms works well for most use cases

### Image Quality

Adjust image quality in the `processFrame` function:

```typescript
const photo = await cameraRef.current.takePictureAsync({
  quality: 0.5, // 0.1 (low) to 1.0 (high)
  base64: true,
  skipProcessing: true,
});
```

Lower quality = faster upload and processing, but may reduce detection accuracy.

## Features Implemented

✅ **Real-time Detection**: Processes camera frames continuously
✅ **Visual Overlays**: Draws bounding boxes with labels and confidence scores
✅ **Color-coded Objects**: Each detected object gets a unique color
✅ **Processing Indicator**: Shows when the API is processing
✅ **Detection Counter**: Displays number of objects detected
✅ **Voice Announcements**: Speak button announces detected objects
✅ **Performance Optimized**: Prevents concurrent API calls

## Popular Instance Segmentation APIs

If you haven't chosen an API yet, here are some options:

1. **Roboflow** (Recommended for beginners)
   - Easy to use, has free tier
   - Endpoint: `https://detect.roboflow.com/your-model/version?api_key=YOUR_KEY`
   
2. **Hugging Face Inference API**
   - Free tier available
   - Endpoint: `https://api-inference.huggingface.co/models/MODEL_NAME`

3. **Custom Model** (TensorFlow Serving, PyTorch Serve, etc.)
   - Deploy your own model
   - Full control over API format

4. **Azure Computer Vision** or **Google Cloud Vision**
   - Enterprise-grade, pay-per-use
   - More expensive but highly accurate

## Testing

1. Make sure camera permissions are granted
2. The app will start processing frames automatically
3. Detected objects will appear with colored bounding boxes
4. Tap "Speak Detections" to hear what's detected

## Troubleshooting

### No Objects Detected
- Check API URL and key in `.env`
- Verify API is responding (check network logs)
- Ensure API response format matches expected structure
- Adjust confidence threshold in API request

### Slow Performance
- Increase frame processing interval (e.g., 1000ms)
- Lower image quality
- Check internet connection speed
- Consider using a faster API endpoint

### Bounding Boxes Not Visible
- Verify bbox coordinates are in correct format [x, y, width, height]
- Check if coordinates are in pixels relative to image dimensions
- May need to scale coordinates to match camera view size

## Next Steps

1. Add your API credentials to `.env`
2. Test with simple objects (phone, cup, etc.)
3. Adjust performance settings based on your needs
4. Consider adding filters for specific object types
5. Implement object tracking across frames
