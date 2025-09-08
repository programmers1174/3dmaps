import React, { useState } from 'react';
import Map from './components/Map';
import './App.css';

const App: React.FC = () => {
  const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiYWRodmlrdmFyc2huZXkiLCJhIjoiY21hYTl4ZjBoMXkwbTJycHp2Nzhia2c2eCJ9.BNlpn1zEm1-G7FBeMPYBUA';
  const [skyGradient, setSkyGradient] = useState<'blue' | 'sunset' | 'night'>('sunset');

  const handleSkyGradientChange = (gradient: 'blue' | 'sunset' | 'night') => {
    setSkyGradient(gradient);
  };

  return (
    <div className="App">
      <Map 
        accessToken={MAPBOX_ACCESS_TOKEN}
        initialZoom={15}
        skyGradient={skyGradient}
        onSkyGradientChange={handleSkyGradientChange}
      />
    </div>
  );
};

export default App; 