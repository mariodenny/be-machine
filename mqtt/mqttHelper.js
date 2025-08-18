const mqtt = require('mqtt');
const sensorController = require('../controllers/V2/sensorController'); // Adjust path
const { log } = require('console');
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

const client = mqtt.connect(options);

client.on('connect', () => {
  console.log("MQTT connected to HiveMQ Cloud");
  console.log(`Connected to: ${options.host}:${options.port}`);

  // Subscribe ke semua topics yang diperlukan
  subscribeToAllTopics();
});

client.on('error', (err) => {
  console.error("MQTT connection error:", err.message);
});

client.on('disconnect', () => {
  console.log("MQTT disconnected");
});

client.on('reconnect', () => {
  console.log("MQTT reconnecting...");
});

client.on('offline', () => {
  console.log("MQTT offline");
});

const publishConfig = (chipId, payload) => {
  if (!client.connected) {
    console.warn("MQTT not connected, cannot publish config");
    return false;
  }

  const topic = `machine/${chipId}/config`;
  const message = JSON.stringify(payload);

  client.publish(topic, message, { qos: 1, retain: false }, (err) => {
    if (err) {
      console.error("❌ Publish config error:", err.message);
    } else {
      console.log(`📤 Published config to ${topic}`);
      console.log(`📋 Config data:`, payload);
      console.log(`Message ${message}`)
    }
  });

  return true;
};

const publishCommand = (chipId, command) => {
  if (!client.connected) {
    console.warn("⚠️ MQTT not connected, cannot publish command");
    return false;
  }

  const topic = `machine/${chipId}/command`;
  const message = command.toLowerCase();

  client.publish(topic, message, { qos: 1, retain: false }, (err) => {
    if (err) {
      console.error("❌ Publish command error:", err.message);
    } else {
      console.log(`📤 Sent command '${message}' to ${topic}`);
    }
  });

  return true;
};

const subscribeToTopic = (topic, callback) => {
  if (!client.connected) {
    console.warn("⚠️ MQTT not connected, cannot subscribe");
    return false;
  }

  client.subscribe(topic, { qos: 1 }, (err) => {
    if (err) {
      console.error(`❌ Subscribe error for ${topic}:`, err.message);
    } else {
      console.log(`📥 Subscribed to ${topic}`);
    }
  });

  client.on('message', (receivedTopic, message) => {
    if (receivedTopic === topic && callback) {
      try {
        const data = JSON.parse(message.toString());
        callback(receivedTopic, data);
      } catch (e) {
        callback(receivedTopic, message.toString());
      }
    }
  });

  return true;
};

// Function untuk subscribe ke semua topics yang diperlukan
const subscribeToAllTopics = () => {
  const topics = [
    'sensor/+/data',           // Individual sensor data
    'machine/+/status',        // Machine status
    'machine/+/connection',    // Connection status
    'machine/+/heartbeat',     // Heartbeat
  ];

  topics.forEach(topic => {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`❌ Error subscribing to ${topic}:`, err.message);
      } else {
        console.log(`📥 Subscribed to: ${topic}`);
      }
    });
  });
};

// Main message handler
client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log(`📥 Received from ${topic}:`, data);

    // Handle sensor data
    if (topic.startsWith('sensor/') && topic.endsWith('/data')) {
      await sensorController.saveSensorDataFromMQTT(data);
    }

    // Handle machine status
    else if (topic.includes('/status')) {
      await sensorController.saveMachineStatus(data);
    }

    // Handle connection status
    else if (topic.includes('/connection')) {
      await sensorController.saveConnectionStatus(data);
    }

    // Handle heartbeat
    else if (topic.includes('/heartbeat')) {
      await sensorController.saveHeartbeat(data);
    }

  } catch (error) {
    console.error('❌ Error processing MQTT message:', error.message);
    console.log('Raw message:', message.toString());
  }
});

// Function untuk send config ke ESP32 berdasarkan machine
const sendMachineConfig = async (chipId, machineData) => {
  try {
    const Machine = require('../models/machineModel'); // Adjust path

    // Get machine info
    const machine = await Machine.findOne({ chipId });
    if (!machine) {
      console.error(`❌ Machine not found for chipId: ${chipId}`);
      return false;
    }

    // Prepare config payload
    const config = {
      machineId: machine._id.toString(),
      rentalId: machineData.rentalId || "",
      statusInterval: 5000,
      sensors: machineData.sensors || [
        {
          sensorId: `${machine._id}_suhu`,
          sensorType: "suhu",
          isActive: true,
          readInterval: 10000
        },
        {
          sensorId: `${machine._id}_tekanan`,
          sensorType: "tekanan",
          isActive: true,
          readInterval: 5000
        },
        {
          sensorId: `${machine._id}_getaran`,
          sensorType: "getaran",
          isActive: true,
          readInterval: 3000
        }
      ]
    };

    return publishConfig(chipId, config);
  } catch (error) {
    console.error('❌ Error sending machine config:', error.message);
    return false;
  }
};

// Function untuk send command ke machine
const sendMachineCommand = (chipId, command) => {
  return publishCommand(chipId, command);
};

const isConnected = () => {
  return client.connected;
};

// Cleanup on process exit
process.on('SIGINT', () => {
  console.log('Closing MQTT connection...');
  client.end();
  process.exit();
});

module.exports = {
  client,
  publishConfig,
  publishCommand,
  subscribeToTopic,
  isConnected,
  sendMachineConfig,
  sendMachineCommand,
  subscribeToAllTopics
};