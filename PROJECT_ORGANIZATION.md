# 🗺️ 3D Maps Project - Organization & Documentation

## 📁 **Project Structure**

```
maps/
├── src/
│   ├── components/
│   │   └── Map.tsx                    # Main map component (3789 lines)
│   ├── App.tsx                        # App entry point
│   └── App.css                        # Styles
├── package.json                       # Dependencies
├── PROJECT_ORGANIZATION.md            # This file
└── README.md                          # Project overview
```

## 🎯 **Core Features**

### 1. **3D Map Rendering**
- **Technology**: Mapbox GL JS with Three.js integration
- **Default Style**: Satellite (`mapbox://styles/mapbox/satellite-streets-v12`)
- **3D Features**: Buildings, terrain, custom layers
- **Location**: San Francisco (default coordinates: `[-122.4194, 37.7749]`)

### 2. **World Layout Settings Panel**
- **Access**: Top panel button "World Layout"
- **Features**:
  - Map style selection (Streets, Satellite, Dark, Light, etc.)
  - 3D Buildings toggle
  - Terrain toggle
  - Show/hide map labels
  - **World Building Color picker** ⭐
  - Terrain exaggeration slider
  - Refresh 3D features button
  - Debug layers button

## 🔧 **Key Fixes & Improvements**

### ✅ **World Building Color Issue (FIXED)**
**Problem**: Building colors wouldn't change when using color picker
**Solution**: 
- Removed satellite style color override
- Direct paint property updates instead of layer reinitialization
- Always use `worldBuildingColor` regardless of map style

**Files Modified**:
- `src/components/Map.tsx` - `changeWorldBuildingColor()` function
- `src/components/Map.tsx` - `initializeLayers()` function

### ✅ **Default Style Issue (FIXED)**
**Problem**: App started with Streets instead of Satellite
**Solution**: 
- Updated `App.tsx` to pass satellite style
- Changed default in Map component

**Files Modified**:
- `src/App.tsx` - `initialStyle` prop
- `src/components/Map.tsx` - default `initialStyle`

## 📍 **Code Navigation Guide**

### **Map Initialization**
```typescript
// Location: src/components/Map.tsx, around line 1500
useEffect(() => {
  // Map initialization logic
  const mapInstance = new mapboxgl.Map({...});
}, []);
```

### **World Building Color Function**
```typescript
// Location: src/components/Map.tsx, around line 342
const changeWorldBuildingColor = (newColor: string) => {
  // Updates building colors immediately
};
```

### **Layer Management**
```typescript
// Location: src/components/Map.tsx, around line 400
const initializeLayers = useCallback(() => {
  // Adds 3D buildings and terrain
}, [layers3D, style, worldBuildingColor, terrainExaggeration]);
```

### **Settings Panel**
```typescript
// Location: src/components/Map.tsx, around line 3200
{showSettings && (
  <div style={{...}}>
    {/* World Layout Settings Panel */}
  </div>
)}
```

## 🎨 **Color Management**

### **World Building Color**
- **State**: `worldBuildingColor` (default: `#ffffff`)
- **Update Function**: `changeWorldBuildingColor()`
- **Layers Affected**: `3d-buildings`, `3d-buildings-simple`
- **Behavior**: Updates immediately, works with all map styles

## 🗂️ **State Management**

### **Map State**
```typescript
const [style, setStyle] = useState(initialStyle);
const [showLabels, setShowLabels] = useState(false);
const [layers3D, setLayers3D] = useState([...]);
const [worldBuildingColor, setWorldBuildingColor] = useState('#ffffff');
const [terrainExaggeration, setTerrainExaggeration] = useState(1);
```

### **UI State**
```typescript
const [showSettings, setShowSettings] = useState(false);
const [showSidePanel, setShowSidePanel] = useState(true);
```

## 🔍 **Debugging Tools**

### **Debug Layers Button**
- **Location**: Settings panel
- **Function**: Logs all `fill-extrusion` layers to console
- **Usage**: Click to see available building layers

### **Console Logging**
- **Color Changes**: `console.log('Changing world building color to:', newColor)`
- **Layer Updates**: `console.log('Updating layer:', layerName)`
- **Map Events**: Various map state changes logged

## 🚀 **Common Tasks & Solutions**

### **Change Default Map Style**
1. Edit `src/App.tsx` - `initialStyle` prop
2. Edit `src/components/Map.tsx` - default `initialStyle`

### **Add New Map Style**
1. Add to `mapStyles` array in `Map.tsx`
2. Update style selection dropdown

### **Fix Building Color Issues**
1. Check `changeWorldBuildingColor()` function
2. Verify layer names in `buildingLayerNames` array
3. Use debug button to see available layers

### **Add New 3D Feature**
1. Add to `layers3D` state
2. Update `initializeLayers()` function
3. Add toggle function

## 📝 **Recent Commits**

### **Latest Commit**: `4ad7338`
- Fixed world building color updates
- Set default to satellite style
- Removed satellite color override
- Added debug functionality

### **Previous Commit**: `1655945`
- World layout working again
- Basic functionality restored

## 🎯 **Quick Reference**

### **File Locations**
- **Main Component**: `src/components/Map.tsx`
- **App Entry**: `src/App.tsx`
- **Mapbox Token**: `src/App.tsx` line 6

### **Key Functions**
- **Color Update**: `changeWorldBuildingColor()` - line ~342
- **Layer Init**: `initializeLayers()` - line ~400
- **Map Init**: `useEffect` - line ~1500
- **Settings Panel**: JSX around line ~3200

### **State Variables**
- **Map Style**: `style`
- **Building Color**: `worldBuildingColor`
- **3D Layers**: `layers3D`
- **UI Panels**: `showSettings`, `showSidePanel`

---

## 🔄 **How to Use This Documentation**

When you ask a question, I'll reference this file to:
1. **Locate relevant code sections** quickly
2. **Understand the current state** of features
3. **Find previous fixes** and solutions
4. **Navigate the codebase** efficiently
5. **Provide accurate answers** based on the actual implementation

This documentation will be updated as we continue working on the project! 