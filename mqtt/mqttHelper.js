const mqtt = require('mqtt');
const sensorController = require('../controllers/V2/sensorController'); // Adjust path
const Machine = require('../models/machineModel');
const {
  log
} = require('console');
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
    this.activeRentals = new Map(); // Store active rental info
    this.topics = {
      CONFIG: 'rental/config',
      REPORT: 'rental/report',
      SENSOR_DATA: 'rental/sensor/data'
    };
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

  // Subscribe to necessary topics
  subscribeToTopics() {
    const topicsToSubscribe = [
      this.topics.REPORT,
      this.topics.SENSOR_DATA
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
  // Handle incoming messages
  async handleMessage(topic, message) {
    try {
      const messageStr = message.toString();
      const data = JSON.parse(messageStr);

      console.log(`\n📥 Received on ${topic}:`);
      console.log(JSON.stringify(data, null, 2));

      switch (topic) {
        case this.topics.REPORT:
          await this.handleReportMessage(data);
          break;
        case this.topics.SENSOR_DATA:
          await this.handleSensorData(data);
          break;
        default:
          console.log(`❓ Unknown topic: ${topic}`);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
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
        startTime: new Date(),
        lastActivity: new Date()
      });
      console.log(`✅ Rental ${rentalId} for machine ${machineId} is now active`);
    } else if (status === 'success' && message.includes('stopped')) {
      this.activeRentals.delete(machineId);
      console.log(`🛑 Rental for machine ${machineId} stopped`);
    }

    // TODO: Save to database if needed
    // await this.saveReportToDatabase(data);
  }

  // Handle sensor data from ESP32
  async handleSensorData(data) {
    const {
      machineId,
      rentalId,
      sensorId,
      sensorType,
      value,
      timestamp,
      unit
    } = data;

    console.log(`🌡️ Sensor Data - ${sensorType.toUpperCase()}: ${value}${unit}`);
    console.log(`🏷️ Machine: ${machineId}, Rental: ${rentalId}, Sensor: ${sensorId}`);

    // Validate rental is active
    if (!this.activeRentals.has(machineId)) {
      console.log(`⚠️ Warning: Received data from inactive rental`);
      return;
    }

    // Update last activity
    const rental = this.activeRentals.get(machineId);
    rental.lastActivity = new Date();

    try {
      // Save sensor data using your MQTT-specific function
      await sensorController.saveSensorDataFromMQTT({
        machineId,
        rentalId,
        sensorId,
        sensorType,
        value,
        unit,
        timestamp: new Date(timestamp)
      });

      await sendThresholdNotification(machineId, {
        sensorType: sensorType,
        value: value,
        unit: unit || this.getUnit(sensorType),
        timestamp: new Date(timestamp)
      });

      const machine = await Machine.findById(machineId);
      if (machine && machine.sensorThresholds) {
        let status = 'normal';
        if (value >= machine.sensorThresholds.warning) {
          status = 'warning';

          // Auto shutdown jika dienable
          if (machine.sensorThresholds.autoShutdown) {
            await emergencyShutdown(rentalId,
              `Auto shutdown: Sensor ${sensorType} reached warning threshold (${value}${unit})`);
          }
        } else if (value >= machine.sensorThresholds.caution) {
          status = 'caution';
        }

        // Update real-time status
        await Machine.findByIdAndUpdate(machineId, {
          $set: {
            'realTimeStatus.sensorValue': value,
            'realTimeStatus.status': status,
            'realTimeStatus.lastUpdate': new Date()
          }
        });
      }

      console.log(`💾 Sensor data saved to database`);
    } catch (error) {
      console.error('❌ Error saving sensor data:', error);
    }
  }

  // Send rental configuration to ESP32
  async startRental(machineId, rentalId) {
    if (!this.isConnected) {
      throw new Error('MQTT not connected');
    }

    // Validate machine exists
    try {
      const machine = await Machine.findById(machineId);
      if (!machine) {
        throw new Error(`Machine ${machineId} not found`);
      }
    } catch (error) {
      console.error('❌ Machine validation error:', error);
      throw error;
    }

    const configMessage = {
      action: 'startRental',
      machineId: machineId,
      rentalId: rentalId,
      timestamp: Date.now(),
      sensorConfig: {
        readInterval: 5000, // 5 seconds
        enabledSensors: ['suhu', 'kelembaban']
      }
    };

    const success = this.client.publish(
      this.topics.CONFIG,
      JSON.stringify(configMessage), {
        qos: 1
      }
    );

    if (success) {
      console.log(`🚀 Rental config sent to machine ${machineId}`);
      console.log(`📤 Config:`, configMessage);
      return {
        success: true,
        message: 'Rental configuration sent'
      };
    } else {
      throw new Error('Failed to send rental configuration');
    }
  }

  // Stop rental
  async stopRental(machineId, rentalId) {
    if (!this.isConnected) {
      throw new Error('MQTT not connected');
    }

    const configMessage = {
      action: 'stopRental',
      machineId: machineId,
      rentalId: rentalId,
      timestamp: Date.now()
    };

    const success = this.client.publish(
      this.topics.CONFIG,
      JSON.stringify(configMessage), {
        qos: 1
      }
    );

    if (success) {
      console.log(`🛑 Stop rental sent to machine ${machineId}`);
      this.activeRentals.delete(machineId);
      return {
        success: true,
        message: 'Stop rental sent'
      };
    } else {
      throw new Error('Failed to send stop rental command');
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

  // Health check
  isHealthy() {
    return {
      mqttConnected: this.isConnected,
      activeRentals: this.activeRentals.size,
      uptime: process.uptime()
    };
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