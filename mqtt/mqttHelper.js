const mqtt = require('mqtt');
const sensorController = require('../controllers/V2/sensorController');
const SensorV2 = require('../models/V2/sensorModel');
const Machine = require('../models/machineModel');
const {
  sendThresholdNotification
} = require('../utils/notification-treshold-service');
require('dotenv').config();

// HiveMQ Cloud configuration
const options = {
  host: process.env.HIVEMQ_HOST,
  port: process.env.HIVEMQ_PORT || 8883,
  username: process.env.HIVEMQ_USERNAME,
  password: process.env.HIVEMQ_PASSWORD,
  protocol: 'mqtts',
  clean: true,
  connectTimeout: 4000,
  clientId: `nodejs_${Math.random().toString(16).substr(2, 8)}`,
  reconnectPeriod: 1000,
};

class MqttRentalHelper {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.activeRentals = new Map();
    this.espConnections = new Map();
  }

  // Initialize MQTT connection
  async init() {
    try {
      console.log('🔗 Connecting to MQTT broker...');
      this.client = mqtt.connect(options);

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('✅ MQTT Connected successfully!');
        this.subscribeToTopics();
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });

      this.client.on('error', (error) => {
        console.error('❌ MQTT Error:', error);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        console.log('🔌 MQTT Connection closed');
        this.isConnected = false;
      });

      this.client.on('reconnect', () => {
        console.log('🔄 MQTT Reconnecting...');
      });

    } catch (error) {
      console.error('❌ Failed to initialize MQTT:', error);
    }
  }

  subscribeToTopics() {
    const topicsToSubscribe = [
      'machine/+/heartbeat',
      'machine/+/connection',
      'machine/+/report',
      'sensor/+/data'
    ];

    topicsToSubscribe.forEach(topic => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`❌ Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`📩 Subscribed to: ${topic}`);
        }
      });
    });
  }

  async handleSensorData(data) {
  const {
    machineId,
    rentalId,
    sensorId,
    sensorType,
    value,
    timestamp,
    unit,
    warningStatus,
    relayState,
    emergencyShutdown
  } = data;

  console.log(`🌡️ Sensor Data - ${sensorType.toUpperCase()}: ${value}${unit || ''}`);
  console.log(`🏷️ Machine: ${machineId}, Rental: ${rentalId}, Sensor: ${sensorId}`);

  // Rental check
  if (this.activeRentals.has(machineId)) {
    const rental = this.activeRentals.get(machineId);
    rental.lastActivity = new Date();
  } else {
    console.log(`⚠️ Warning: Received data from inactive rental`);
  }

  try {
    // 1. FIND MACHINE
    const machine = await Machine.findById(machineId);
    if (!machine) {
      console.error(`❌ Machine not found: ${machineId}`);
      return;
    }

    // 2. UPDATE REAL-TIME STATUS DI MACHINE
    if (!machine.realTimeStatus || !(machine.realTimeStatus instanceof Map)) {
      machine.realTimeStatus = new Map();
    }

    const statusMap = {
      'NORMAL': 'normal',
      'WARNING': 'warning',
      'DANGER': 'danger',
      'CRITICAL': 'critical'
    };
    const status = statusMap[warningStatus] || 'normal';

    machine.updateSensorStatus(sensorId, {
      sensorValue: value,
      sensorType,
      unit,
      status
    });

    // Update relay & buzzer
    if (relayState !== undefined) machine.relayState = relayState;
    if (emergencyShutdown !== undefined) machine.buzzerState = emergencyShutdown;

    await machine.save();
    console.log(`✅ Updated realTimeStatus for ${sensorType}: ${value}${unit || ''} [${status}]`);
    console.log(`📊 Global Status: ${machine.globalStatus}`);

    // 3. SAVE TO SENSORV2 COLLECTION (YANG BARU DITAMBAHKAN)
    try {
      const sensorRecord = new SensorV2({
        machineId: machineId,
        rentalId: rentalId,
        chipId: data.chipId || machine.chipId,
        sensorId: sensorId,
        sensorType: sensorType,
        value: value,
        unit: unit || this.getUnit(sensorType),
        mqttTopic: `sensor/${sensorId}/data`,
        deviceTimestamp: Date.now(),
        waktu: Date.now(),
        
        // Legacy fields untuk backward compatibility
        current: sensorType === 'current' ? value : null,
        button: sensorType === 'button' ? Boolean(value) : null,
        buzzerStatus: sensorType === 'buzzer' ? Boolean(value) : null,
        
        // Status info
        isValid: true,
        errorCode: null
      });

      await sensorRecord.save();
      console.log(`💾 Saved to SensorV2: ${sensorType} = ${value}${unit || ''}`);
      
    } catch (sensorSaveError) {
      console.error('❌ Failed to save to SensorV2:', sensorSaveError.message);
      // Jangan throw error utama, hanya log saja
    }

    // 4. THRESHOLD NOTIFICATION
    await sendThresholdNotification(machineId, {
      sensorType,
      value,
      unit: unit || this.getUnit(sensorType),
      timestamp: new Date(timestamp || Date.now())
    });

    // 5. AUTO SHUTDOWN LOGIC
    if (status === 'critical' || status === 'danger') {
      console.log(`⚠️ ${status.toUpperCase()} status detected for ${sensorType}`);

      const sensorConfig = machine.sensorConfigs.find(
        cfg => cfg.sensorId === sensorId
      );

      if (sensorConfig?.thresholds) {
        await this.emergencyShutdown(
          rentalId,
          `Auto shutdown: ${sensorType} reached ${status} (${value}${unit || ''})`
        );
      }
    }

  } catch (error) {
    console.error('❌ Error handling sensor data:', error);
    console.error('Stack:', error.stack);
  }
}
  async handleMultipleSensorData(data) {
  if (Array.isArray(data.sensors)) {
    console.log(`📦 Received batch of ${data.sensors.length} sensors`);
    
    const promises = data.sensors.map(sensor => {
      return this.handleSingleSensorData({
        ...data,
        sensorId: sensor.sensorId,
        sensorType: sensor.sensorType,
        value: sensor.value,
        unit: sensor.unit,
        warningStatus: sensor.warningStatus
      });
    });
    
    await Promise.all(promises);
  } else {
    // Handle single sensor data
    await this.handleSingleSensorData(data);
  }
}

// Helper untuk handle single sensor
async handleSingleSensorData(data) {
  const {
    machineId,
    rentalId,
    sensorId,
    sensorType,
    value,
    timestamp,
    unit,
    warningStatus
  } = data;

  try {
    // Validasi sensor type sesuai enum di SensorV2
    const validSensorTypes = ['suhu', 'kelembaban', 'tekanan', 'getaran', 'current', 'button', 'buzzer', 'delay_test'];
    
    if (!validSensorTypes.includes(sensorType)) {
      console.warn(`⚠️ Unknown sensor type: ${sensorType}, mapping to closest...`);
      // Mapping sensor type yang mungkin dikirim ESP
      const sensorTypeMapping = {
        'thermocouple_k': 'suhu',
        'vibration_sensor': 'getaran',
        'temperature': 'suhu',
        'vibration': 'getaran',
        'pressure': 'tekanan',
        'humidity': 'kelembaban',
        'power': 'current'
      };
      
      const mappedType = sensorTypeMapping[sensorType] || 'suhu';
      data.sensorType = mappedType;
    }

    // Save to SensorV2
    const sensorRecord = new SensorV2({
      machineId: machineId,
      rentalId: rentalId,
      chipId: data.chipId,
      sensorId: sensorId,
      sensorType: data.sensorType, // Use mapped type
      value: parseFloat(value),
      unit: unit || this.getUnit(data.sensorType),
      mqttTopic: `sensor/${sensorId}/data`,
      deviceTimestamp: Date.now(),
      waktu: Date.now(),
      
      // Set legacy fields
      current: data.sensorType === 'current' ? parseFloat(value) : null,
      button: data.sensorType === 'button' ? Boolean(value) : null,
      buzzerStatus: data.sensorType === 'buzzer' ? Boolean(value) : null,
      
      isValid: true,
      errorCode: null
    });

    await sensorRecord.save();
    console.log(`💾 SensorV2 saved: ${sensorId} (${data.sensorType}) = ${value}${unit || ''}`);
    
  } catch (error) {
    console.error(`❌ Failed to save sensor ${sensorId}:`, error.message);
  }
}

  // Handle incoming messages
 async handleMessage(topic, message) {
  try {
    const messageStr = message.toString();
    const data = JSON.parse(messageStr);

    console.log(`\n📥 Received on ${topic}:`);
    console.log(JSON.stringify(data, null, 2));

    // Extract chipId from topic
    const topicParts = topic.split('/');
    const chipId = topicParts[1];

    // Handle different message types
    if (topic.includes('/heartbeat')) {
      await this.handleHeartbeat(chipId, data);
    } else if (topic.includes('/connection')) {
      await this.handleConnection(chipId, data);
    } else if (topic.includes('/report')) {
      await this.handleReportMessage(data);
    } else if (topic.includes('/data')) {
      if (data.sensors && Array.isArray(data.sensors)) {
        await this.handleMultipleSensorData({
          ...data,
          chipId: chipId
        });
      } else {
        await this.handleSensorData({
          ...data,
          chipId: chipId
        });
      }
    } else if (topic.includes('/sensors')) {
      // New endpoint for multiple sensors
      await this.handleMultipleSensorData({
        ...data,
        chipId: chipId
      });
    } else {
      console.log(`❓ Unknown topic: ${topic}`);
    }
  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
}

  // NEW: Handle heartbeat untuk track ESP online status
  async handleHeartbeat(chipId, data) {
    console.log(`💓 Heartbeat from ${chipId}`);

    // Update ESP connection tracking
    this.espConnections.set(chipId, {
      lastSeen: new Date(),
      machineId: data.machineId || null,
      isStarted: data.isStarted || false,
      systemReady: data.systemReady || false,
      ip: data.ip,
      rssi: data.rssi
    });

    // Jika machineId ada di heartbeat, update active rentals
    if (data.machineId && data.isStarted) {
      this.activeRentals.set(data.machineId, {
        rentalId: data.rentalId || null,
        chipId: chipId,
        startTime: new Date(),
        lastActivity: new Date()
      });
    }
  }

  // NEW: Handle connection status
  async handleConnection(chipId, data) {
    console.log(`📡 Connection status from ${chipId}: ${data.status}`);

    if (data.status === 'online') {
      this.espConnections.set(chipId, {
        lastSeen: new Date(),
        machineId: null, // Belum ada machineId
        isStarted: true,
        systemReady: data.systemReady || false,
        ip: data.ip,
        rssi: data.rssi
      });
    } else if (data.status === 'offline') {
      // Cari dan hapus dari active rentals jika ada
      for (let [machineId, rental] of this.activeRentals) {
        if (rental.chipId === chipId) {
          this.activeRentals.delete(machineId);
          console.log(`🛑 Removed rental for machine ${machineId} (ESP ${chipId} offline)`);
        }
      }
    }
  }

  // Handle report messages from ESP32
  async handleReportMessage(data) {
    const {
      machineId,
      rentalId,
      status,
      message,
      timestamp
    } = data;

    console.log(`📊 Report - Machine: ${machineId}, Rental: ${rentalId}`);
    console.log(`📊 Status: ${status}, Message: ${message}`);

    // Update rental status in memory
    if (status === 'success' && message.includes('started')) {
      this.activeRentals.set(machineId, {
        rentalId,
        chipId: data.chipId,
        startTime: new Date(),
        lastActivity: new Date()
      });
      console.log(`✅ Rental ${rentalId} for machine ${machineId} is now active`);
    } else if (status === 'success' && message.includes('stopped')) {
      this.activeRentals.delete(machineId);
      console.log(`🛑 Rental for machine ${machineId} stopped`);
    }
  }

  async handleSingleSensorData(data) {
  const {
    machineId,
    rentalId,
    sensorId,
    sensorType,
    value,
    timestamp,
    unit,
    warningStatus
  } = data;

  try {
    // Validasi sensor type sesuai enum di SensorV2
    const validSensorTypes = ['suhu', 'kelembaban', 'tekanan', 'getaran', 'current', 'button', 'buzzer', 'delay_test'];
    
    if (!validSensorTypes.includes(sensorType)) {
      console.warn(`⚠️ Unknown sensor type: ${sensorType}, mapping to closest...`);
      // Mapping sensor type yang mungkin dikirim ESP
      const sensorTypeMapping = {
        'thermocouple_k': 'suhu',
        'vibration_sensor': 'getaran',
        'temperature': 'suhu',
        'vibration': 'getaran',
        'pressure': 'tekanan',
        'humidity': 'kelembaban',
        'power': 'current'
      };
      
      const mappedType = sensorTypeMapping[sensorType] || 'suhu';
      data.sensorType = mappedType;
    }

    // Save to SensorV2
    const sensorRecord = new SensorV2({
      machineId: machineId,
      rentalId: rentalId,
      chipId: data.chipId,
      sensorId: sensorId,
      sensorType: data.sensorType, // Use mapped type
      value: parseFloat(value),
      unit: unit || this.getUnit(data.sensorType),
      mqttTopic: `sensor/${sensorId}/data`,
      deviceTimestamp: Date.now(),
      waktu: Date.now(),
      
      current: data.sensorType === 'current' ? parseFloat(value) : null,
      button: data.sensorType === 'button' ? Boolean(value) : null,
      buzzerStatus: data.sensorType === 'buzzer' ? Boolean(value) : null,
      
      isValid: true,
      errorCode: null
    });

    await sensorRecord.save();
    console.log(`💾 SensorV2 saved: ${sensorId} (${data.sensorType}) = ${value}${unit || ''}`);
    
  } catch (error) {
    console.error(`❌ Failed to save sensor ${sensorId}:`, error.message);
  }
}



  getUnit(sensorType) {
    const units = {
      'suhu': '°C',
      'getaran': 'mm/s',
      'tekanan': 'bar',
      'current': 'A',
      'kelembaban': '%'
    };
    return units[sensorType] || '';
  }

  findAvailableESP() {
    const available = [];
    for (let [chipId, esp] of this.espConnections) {
      // ESP online dan tidak memiliki machineId (belum dipakai)
      if (!esp.machineId && esp.systemReady) {
        available.push({
          chipId: chipId,
          lastSeen: esp.lastSeen,
          ip: esp.ip,
          rssi: esp.rssi
        });
      }
    }
    return available;
  }

  async startRental(machineId, rentalId) {
    if (!this.isConnected) {
      throw new Error('MQTT not connected');
    }

    try {
      const availableESPs = this.findAvailableESP();
      console.log(`📡 Available ESPs: ${JSON.stringify(availableESPs.map(esp => esp.chipId))}`); // cek esp yang ada

      if (availableESPs.length === 0) {
        throw new Error('No available ESP32 devices found');
      }

      const configMessage = {
        action: 'startRental',
        machineId: machineId,
        rentalId: rentalId,
        timestamp: Date.now(),
        sensorConfig: {
          readInterval: 1000,
        }
      };

      // KIRIM KE SEMUA ESP YANG AVAILABLE
      const results = [];

      for (const targetESP of availableESPs) {
        const chipId = targetESP.chipId;
        const topic = `machine/${chipId}/config`;

        const success = this.client.publish(
          topic,
          JSON.stringify(configMessage), {
            qos: 0,
            retain: false
          }
        );

        if (success) {
          console.log(`🚀 Rental config sent to ESP ${chipId}`);

          this.espConnections.set(chipId, {
            ...this.espConnections.get(chipId),
            machineId: machineId
          });

          results.push({
            success: true,
            chipId: chipId,
            topic: topic
          });
        } else {
          console.log(`❌ Failed to send to ESP ${chipId}`);
          results.push({
            success: false,
            chipId: chipId,
            error: 'Publish failed'
          });
        }
      }

      if (results.some(r => r.success)) {
        const firstSuccess = results.find(r => r.success);
        this.activeRentals.set(machineId, {
          rentalId: rentalId,
          chipId: firstSuccess.chipId,
          startTime: new Date(),
          lastActivity: new Date()
        });
      }

      return {
        success: true,
        message: `Rental configuration sent to ${results.filter(r => r.success).length} ESP devices`,
        results: results,
        totalSent: results.length,
        successful: results.filter(r => r.success).length
      };

    } catch (error) {
      console.error('❌ Start rental error:', error);
      throw error;
    }
  }

  // Stop rental - MODIFIED
  async stopRental(machineId, rentalId) {
    if (!this.isConnected) {
      throw new Error('MQTT not connected');
    }

    try {
      const rental = this.activeRentals.get(machineId);
      if (!rental) {
        throw new Error(`No active rental found for machine ${machineId}`);
      }

      const chipId = rental.chipId;
      const configMessage = {
        action: 'stopRental',
        machineId: machineId,
        rentalId: rentalId,
        timestamp: Date.now()
      };

      const topic = `machine/${chipId}/config`;

      const success = this.client.publish(
        topic,
        JSON.stringify(configMessage), {
          qos: 1,
          retain: false
        }
      );

      if (success) {
        console.log(`🛑 Stop rental sent to machine ${machineId} (ESP: ${chipId})`);
        this.activeRentals.delete(machineId);

        // Reset ESP tracking
        if (this.espConnections.has(chipId)) {
          const esp = this.espConnections.get(chipId);
          this.espConnections.set(chipId, {
            ...esp,
            machineId: null,
            isStarted: false
          });
        }

        return {
          success: true,
          message: 'Stop rental sent',
          topic: topic
        };
      } else {
        throw new Error('Failed to send stop rental command');
      }
    } catch (error) {
      console.error('❌ Stop rental error:', error);
      throw error;
    }
  }

  // Get rental status
  getRentalStatus(machineId) {
    if (this.activeRentals.has(machineId)) {
      return {
        isActive: true,
        ...this.activeRentals.get(machineId)
      };
    }
    return {
      isActive: false
    };
  }

  // Get all active rentals
  getActiveRentals() {
    const rentals = [];
    this.activeRentals.forEach((rental, machineId) => {
      rentals.push({
        machineId,
        ...rental
      });
    });
    return rentals;
  }

  // Get all ESP connections
  getESPConnections() {
    const connections = [];
    this.espConnections.forEach((esp, chipId) => {
      connections.push({
        chipId,
        ...esp
      });
    });
    return connections;
  }

  // Health check
  isHealthy() {
    return {
      mqttConnected: this.isConnected,
      activeRentals: this.activeRentals.size,
      espConnections: this.espConnections.size,
      uptime: process.uptime()
    };
  }

  // Emergency shutdown function
  async emergencyShutdown(rentalId, reason) {
    console.log(`🚨 EMERGENCY SHUTDOWN - Rental: ${rentalId}, Reason: ${reason}`);
    // Implement emergency shutdown logic here
  }

  // Graceful shutdown
  async disconnect() {
    if (this.client) {
      console.log('🔌 Disconnecting MQTT...');
      this.client.end();
      this.isConnected = false;
    }
  }
}

// Create singleton instance
const mqttRentalHelper = new MqttRentalHelper();

// Initialize connection
mqttRentalHelper.init();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await mqttRentalHelper.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await mqttRentalHelper.disconnect();
  process.exit(0);
});

module.exports = mqttRentalHelper;