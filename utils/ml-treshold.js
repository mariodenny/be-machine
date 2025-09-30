// services/ml-thresholds.js
const ss = require('simple-statistics');

// Rule-based thresholds berdasarkan standard industri
const industrialStandards = {
  'oven-hardening': {
    sensorType: 'suhu',
    min: 700,
    max: 950,
    optimalRange: { min: 800, max: 900 },
    unit: '°C',
    reference: 'ASM Handbook'
  },
  'mesin-frais-getaran': {
    sensorType: 'getaran', 
    min: 0,
    max: 4.5,
    optimalRange: { min: 0, max: 2.0 },
    unit: 'mm/s',
    reference: 'ISO 10816-3'
  },
  'pneumatic-trainer': {
    sensorType: 'tekanan',
    min: 3.0,
    max: 8.0,
    optimalRange: { min: 4.0, max: 7.0 },
    unit: 'bar',
    reference: 'ISO 4414'
  },
  'motor-mesin-frais': {
    sensorType: 'suhu',
    min: 0,
    max: 90,
    optimalRange: { min: 30, max: 75 },
    unit: '°C',
    reference: 'IEC 60034-1'
  }
};

// Hybrid ML Threshold Calculator
const calculateHybridThresholds = async (machineType, sensorType, machineId = null) => {
  try {
    // 1. Ambil data historis 30 hari
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const filter = { 
      sensorType,
      waktu: { $gte: thirtyDaysAgo } 
    };
    
    if (machineId) filter.machineId = machineId;
    
    const historicalData = await SensorV2.find(filter, { value: 1 });
    const values = historicalData.map(item => item.value);
    
    // 2. Jika data kurang, pakai industrial standard
    if (values.length < 20) {
      return getIndustrialThresholds(machineType, sensorType);
    }
    
    // 3. Hitung statistical values
    const mean = ss.mean(values);
    const stdDev = ss.standardDeviation(values);
    
    // 4. Hybrid Calculation: Combine industrial standard dengan actual data
    const industrial = getIndustrialThresholds(machineType, sensorType);
    
    // Adaptive thresholds berdasarkan statistical analysis
    return {
      normal: Math.max(industrial.normal, mean),
      caution: Math.min(industrial.caution, mean + (1.0 * stdDev)),
      warning: Math.min(industrial.warning, mean + (2.0 * stdDev)),
      critical: industrial.critical,
      basedOn: 'hybrid',
      confidence: calculateConfidence(values.length, stdDev)
    };
    
  } catch (error) {
    return getIndustrialThresholds(machineType, sensorType);
  }
};

// Industrial standards based thresholds
const getIndustrialThresholds = (machineType, sensorType) => {
  const standards = {
    'oven-hardening': {
      normal: 800,
      caution: 900,
      warning: 925,
      critical: 950,
      unit: '°C'
    },
    'mesin-frais-getaran': {
      normal: 1.0,
      caution: 2.5,
      warning: 3.5,
      critical: 4.5,
      unit: 'mm/s'
    },
    'pneumatic-trainer': {
      normal: 5.0,
      caution: 6.5,
      warning: 7.5,
      critical: 8.0,
      unit: 'bar'
    },
    'motor-mesin-frais': {
      normal: 50,
      caution: 70,
      warning: 80,
      critical: 90,
      unit: '°C'
    }
  };
  
  return standards[machineType] || getFallbackThresholds(sensorType);
};

const getFallbackThresholds = (sensorType) => {
  const fallbacks = {
    'suhu': { normal: 40, caution: 60, warning: 80, critical: 100 },
    'getaran': { normal: 0.5, caution: 1.5, warning: 2.5, critical: 4.0 },
    'tekanan': { normal: 4.0, caution: 6.0, warning: 7.0, critical: 8.0 }
  };
  return fallbacks[sensorType] || { normal: 0, caution: 0, warning: 0, critical: 0 };
};

const calculateConfidence = (dataCount, stdDev) => {
  const countScore = Math.min(dataCount / 100, 1.0);
  const consistencyScore = stdDev > 0 ? Math.min(10 / stdDev, 1.0) : 1.0;
  return (countScore * 0.6 + consistencyScore * 0.4).toFixed(2);
};

module.exports = {
  calculateHybridThresholds,
  getIndustrialThresholds
};