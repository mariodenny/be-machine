const mqtt = require('mqtt');
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

const isConnected = () => {
  return client.connected;
};

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
  isConnected
};