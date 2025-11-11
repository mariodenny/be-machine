#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ---------------- WIFI CONFIG ----------------
const char* ssid = "Ternak Lele";
const char* password = "11221122";

// ---------------- HIVEMQ CLOUD CONFIG ----------------
const char* mqtt_server = "5a4b12ea6b7e4a879fcd9b34a94de671.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_username = "esp-be-machine";
const char* mqtt_password = "Be_Machine@123";

WiFiClientSecure espClient;
PubSubClient client(espClient);

// ---------------- DHT22 CONFIG ----------------
#define DHT_PIN 18       // GPIO 18 untuk DHT22
#define DHT_TYPE DHT22   // Tipe sensor DHT22

// ---------------- RELAY CONFIG ----------------
#define RELAY_PIN 19     // GPIO 19 untuk Relay

DHT dht(DHT_PIN, DHT_TYPE);

// ---------------- STRUKTUR SENSOR ----------------
struct SensorHardware {
  String name;
  String type;
  int pin;
  bool isDetected;
  bool isWorking;
  String errorMessage;
  unsigned long lastCheck;
};

// ---------------- GLOBAL VARIABEL ----------------
String chipId;
String machineId = "";
String rentalId = "";
unsigned long lastSensorSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastHardwareCheck = 0;
unsigned long sensorInterval = 5000;    // Kirim data sensor setiap 5 detik
unsigned long heartbeatInterval = 30000;
unsigned long hardwareCheckInterval = 60000;
bool isStarted = false;
bool mqttConnected = false;
bool systemReady = false;
bool relayState = false;  // Status relay: false = OFF, true = ON

// Hardware sensors yang tersedia (DHT22 saja)
SensorHardware hardwareSensors[1] = {
  {"DHT22", "dht", DHT_PIN, false, false, "", 0}
};

// ---------------- FUNGSI CONTROL RELAY ----------------
void setRelay(bool state) {
  relayState = state;
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
  
  Serial.println("🔌 Relay: " + String(state ? "ON ⚡" : "OFF ⭕"));
  
  // Kirim status relay ke MQTT
  if (mqttConnected) {
    sendRelayStatus();
  }
}

// ---------------- FUNGSI KIRIM STATUS RELAY ----------------
void sendRelayStatus() {
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["relayState"] = relayState;
  doc["timestamp"] = millis();
  doc["isStarted"] = isStarted;
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/relay";
  if (client.publish(topic.c_str(), buffer, 0)) {
    Serial.println("📤 Relay status sent: " + String(relayState ? "ON" : "OFF"));
  } else {
    Serial.println("❌ Failed to send relay status");
  }
}

// ---------------- FUNGSI DETEKSI HARDWARE ----------------
bool detectDHTSensor() {
  Serial.print("🔍 Detecting DHT22 Sensor... ");
  
  try {
    // Test multiple readings
    float temp1 = dht.readTemperature();
    float hum1 = dht.readHumidity();
    delay(2000); // DHT22 butuh waktu antara pembacaan
    float temp2 = dht.readTemperature();
    float hum2 = dht.readHumidity();
    
    // Check if readings are valid
    bool validTemp1 = !isnan(temp1) && temp1 > -50 && temp1 < 80;
    bool validHum1 = !isnan(hum1) && hum1 >= 0 && hum1 <= 100;
    bool validTemp2 = !isnan(temp2) && temp2 > -50 && temp2 < 80;
    bool validHum2 = !isnan(hum2) && hum2 >= 0 && hum2 <= 100;
    
    if (validTemp1 && validHum1 && validTemp2 && validHum2) {
      float avgTemp = (temp1 + temp2) / 2.0;
      float avgHum = (hum1 + hum2) / 2.0;
      Serial.println("✅ DETECTED (Avg: " + String(avgTemp, 1) + "°C, " + String(avgHum, 1) + "%)");
      return true;
    } else {
      Serial.println("❌ FAILED (Invalid readings)");
      Serial.println("   Temp1: " + String(temp1) + "°C, Hum1: " + String(hum1) + "%");
      Serial.println("   Temp2: " + String(temp2) + "°C, Hum2: " + String(temp2) + "%");
      return false;
    }
  } catch (...) {
    Serial.println("❌ FAILED (Exception caught)");
    return false;
  }
}

// ---------------- FUNGSI BACA & KIRIM SEMUA SENSOR ----------------
void readAndSendAllSensors() {
  if (!mqttConnected || !isStarted) {
    Serial.println("⚠️  Skip sensor read - not connected or not started");
    return;
  }
  
  Serial.println("🎯 Reading all available sensors...");
  
  // ⭐⭐ BACA & KIRIM DATA DHT22 (SUHU & KELEMBABAN) ⭐⭐
  if (hardwareSensors[0].isWorking) {
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();
    
    if (!isnan(temperature) && !isnan(humidity)) {
      // Kirim data suhu
      sendSensorData("dht22_suhu", "suhu", temperature, "°C");
      
      // Kirim data kelembaban
      sendSensorData("dht22_kelembaban", "kelembaban", humidity, "%");
      
      Serial.println("📤 Sent: " + String(temperature, 1) + "°C, " + String(humidity, 1) + "%");
    } else {
      Serial.println("❌ DHT22 reading invalid");
      hardwareSensors[0].isWorking = false;
      hardwareSensors[0].errorMessage = "Invalid readings";
    }
  } else {
    Serial.println("⚠️  DHT22 not working, skip reading");
  }
}

// ⭐⭐ FUNGSI KIRIM DATA SENSOR ⭐⭐
void sendSensorData(String sensorId, String sensorType, float value, String unit) {
  StaticJsonDocument<256> doc;
  doc["sensorId"] = sensorId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["sensorType"] = sensorType;
  doc["value"] = value;
  doc["unit"] = unit;
  doc["timestamp"] = millis();
  doc["chipId"] = chipId;
  doc["hardwareAvailable"] = true;
  doc["relayState"] = relayState;  // Tambah status relay di data sensor
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "sensor/" + sensorId + "/data";
  
  if (client.publish(topic.c_str(), buffer, 0)) {
    Serial.println("✅ Sent: " + sensorType + " = " + String(value) + unit + " | Relay: " + String(relayState ? "ON" : "OFF"));
  } else {
    Serial.println("❌ Failed to send: " + sensorType);
  }
}

// ---------------- FUNGSI AUTO DETECT SEMUA HARDWARE ----------------
void detectAllHardware() {
  Serial.println("🔍 === DETECTING HARDWARE SENSORS ===");
  
  // Reset detection status
  for (int i = 0; i < 1; i++) {
    hardwareSensors[i].isDetected = false;
    hardwareSensors[i].isWorking = false;
    hardwareSensors[i].errorMessage = "";
  }
  
  // Detect DHT22 Sensor
  hardwareSensors[0].isDetected = detectDHTSensor();
  hardwareSensors[0].isWorking = hardwareSensors[0].isDetected;
  
  // Summary
  int detectedCount = 0;
  Serial.println("📊 === HARDWARE DETECTION SUMMARY ===");
  for (int i = 0; i < 1; i++) {
    String status = hardwareSensors[i].isDetected ? "✅ AVAILABLE" : "❌ NOT FOUND";
    Serial.println("   " + hardwareSensors[i].name + " (" + hardwareSensors[i].type + "): " + status);
    if (hardwareSensors[i].isDetected) detectedCount++;
  }
  
  Serial.println("🎯 Total detected sensors: " + String(detectedCount) + "/1");
  
  // Update system status
  systemReady = (detectedCount > 0);
  
  if (systemReady) {
    Serial.println("✅ === SYSTEM READY ===");
  } else {
    Serial.println("⚠️  === SYSTEM NOT READY - NO SENSORS DETECTED ===");
  }
}

// ---------------- FUNGSI KIRIM HARDWARE STATUS ----------------
void sendHardwareStatus() {
  if (!mqttConnected) return;
  
  StaticJsonDocument<512> doc;
  doc["chipId"] = chipId;
  doc["timestamp"] = millis();
  doc["systemReady"] = systemReady;
  doc["relayState"] = relayState;  // Tambah status relay
  
  JsonArray hardwareArray = doc.createNestedArray("hardware");
  
  for (int i = 0; i < 1; i++) {
    JsonObject hw = hardwareArray.createNestedObject();
    hw["name"] = hardwareSensors[i].name;
    hw["type"] = hardwareSensors[i].type;
    hw["pin"] = hardwareSensors[i].pin;
    hw["detected"] = hardwareSensors[i].isDetected;
    hw["working"] = hardwareSensors[i].isWorking;
    hw["error"] = hardwareSensors[i].errorMessage;
  }
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/hardware";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("🔧 Hardware status sent | Relay: " + String(relayState ? "ON" : "OFF"));
}

// ---------------- MQTT CALLBACK ----------------
void callback(char* topic, byte* payload, unsigned int length) {
  // payload[length] = '\0';
  // String message = String((char*)payload);
  // Serial.printf("🎯 CALLBACK! Topic: %s\n", topic);
  // Serial.printf("   Message: %s\n", message.c_str());
  payload[length] = '\0';
  String message = String((char*)payload);
  
  Serial.println("=== MQTT MESSAGE RECEIVED ===");
  Serial.println("Topic: " + String(topic));
  Serial.println("Message: " + message);
  Serial.println("Length: " + String(length));
  Serial.println("=============================");
  String topicStr = String(topic);

  if (topicStr.endsWith("/config")) {
    Serial.println("🔧 CONFIG MESSAGE RECEIVED!");
    
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, message);
    if (!err) {
      String action = doc["action"] | "";
      rentalId = doc["rentalId"] | "";
      machineId = doc["machineId"] | "";
      
      // Handle different actions
      if (action == "startRental") {
        if (systemReady) {
          isStarted = true;
          setRelay(true);
          
          Serial.println("🚀 === RENTAL STARTED ===");
          Serial.println("📋 Rental ID: " + rentalId);
          Serial.println("🏭 Machine ID: " + machineId);
          Serial.println("🔌 Relay: ON ⚡");
          Serial.println("🎯 Auto-sending all sensor data every 5 seconds");
          
          detectAllHardware();
          sendHardwareStatus();
          
          sendRentalReport(true, "Rental started successfully - Relay ON");
          
        } else {
          Serial.println("❌ Cannot start rental - system not ready!");
          sendRentalReport(false, "System not ready - no sensors detected");
        }
      }
      else if (action == "stopRental") {
        isStarted = false;
        setRelay(false);
        
        Serial.println("🛑 === RENTAL STOPPED via stopRental ===");
        Serial.println("🔌 Relay: OFF ⭕");
        Serial.println("📋 Rental ID: " + rentalId);
        Serial.println("🏭 Machine ID: " + machineId);
        sendRentalReport(true, "Rental stopped successfully via stopRental - Relay OFF");
        delay(500);
        machineId = "";
        rentalId = "";
      }
      
    } else {
      Serial.println("❌ Failed to parse config JSON");
    }
  }
  
  else if (topicStr.endsWith("/command")) {
    Serial.println("🔧 COMMAND MESSAGE RECEIVED!");
    if (message.startsWith("{")) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, message);
    if (!err) {
      String action = doc["action"] | "";
      
      if (action == "stopRental") {
        isStarted = false;
        setRelay(false);
        Serial.println("🛑 === RENTAL STOPPED via command JSON ===");
        sendRentalReport(true, "Rental stopped via command - Relay OFF");
      }
    }
  } 
    if (message == "start") {
      if (systemReady) {
        isStarted = true;
        
        setRelay(true);
        
        Serial.println("🚀 === MESIN DIHIDUPKAN ===");
        Serial.println("🔌 Relay: ON ⚡");
        sendRentalReport(true, "Machine started via command - Relay ON");
      } else {
        Serial.println("⚠️  Cannot start - no sensors detected!");
        sendRentalReport(false, "Cannot start - system not ready");
      }
    } else if (message == "stop") {
      isStarted = false;
      setRelay(false);
      
      Serial.println("🛑 === MESIN DIMATIKAN ===");
      Serial.println("🔌 Relay: OFF ⭕");
      sendRentalReport(true, "Machine stopped via command - Relay OFF");
    } else if (message == "detect") {
      Serial.println("🔍 Manual hardware detection requested...");
      detectAllHardware();
      sendHardwareStatus();
    } else if (message == "relay_on") {
      // ⭐⭐ COMMAND MANUAL UNTUK NYALA RELAY ⭐⭐
      setRelay(true);
      Serial.println("🔌 Manual: Relay ON ⚡");
    } else if (message == "relay_off") {
      setRelay(false);
      Serial.println("🔌 Manual: Relay OFF ⭕");
    }
  }
}

// ---------------- FUNGSI KIRIM LAPORAN RENTAL ----------------
void sendRentalReport(bool success, String message) {
  if (!mqttConnected || machineId == "") return;
  
  StaticJsonDocument<256> doc;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["chipId"] = chipId;
  doc["status"] = success ? "success" : "error";
  doc["message"] = message;
  doc["timestamp"] = millis();
  doc["isStarted"] = isStarted;
  doc["systemReady"] = systemReady;
  doc["relayState"] = relayState;  // Tambah status relay
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/report";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("📊 Rental report sent: " + message + " | Relay: " + String(relayState ? "ON" : "OFF"));
}

// ---------------- FUNGSI RECONNECT ----------------
void reconnect() {
  while (!client.connected()) {
    Serial.print("🔄 Menghubungkan ke HiveMQ Cloud...");
    
    String clientId = "ESP32-" + chipId + "-" + String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str(), mqtt_username, mqtt_password)) {
      Serial.println(" ✅ Terhubung!");
      mqttConnected = true;
      
      String configTopic = "machine/" + chipId + "/config";
      String commandTopic = "machine/" + chipId + "/command";
      
      client.subscribe(configTopic.c_str(), 1);
      client.subscribe(commandTopic.c_str(), 1);
      
      Serial.println("📥 Subscribed to: " + configTopic);
      Serial.println("📥 Subscribed to: " + commandTopic);
      
      sendConnectionStatus(true);
      sendHardwareStatus();
      
    } else {
      mqttConnected = false;
      Serial.print(" ❌ Gagal, rc=");
      Serial.println(client.state());
      Serial.println("⏳ Retry dalam 5 detik...");
      delay(5000);
    }
  }
}

void sendConnectionStatus(bool connected) {
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["status"] = connected ? "online" : "offline";
  doc["timestamp"] = millis();
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["systemReady"] = systemReady;
  doc["relayState"] = relayState;  // Tambah status relay
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/connection";
  client.publish(topic.c_str(), buffer, true);
  
  Serial.println("📡 Connection status sent: " + String(connected ? "ONLINE" : "OFFLINE") + " | Relay: " + String(relayState ? "ON" : "OFF"));
}

void sendHeartbeat() {
  if (!mqttConnected) return;
  
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["timestamp"] = millis();
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["wifiRSSI"] = WiFi.RSSI();
  doc["machineId"] = machineId;
  doc["isStarted"] = isStarted;
  doc["systemReady"] = systemReady;
  doc["relayState"] = relayState;  // Tambah status relay
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/heartbeat";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("💓 Heartbeat sent | Relay: " + String(relayState ? "ON" : "OFF"));
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("🚀 === ESP32 DHT22 SENSOR + RELAY CONTROL ===");
  
  // Setup DHT22
  dht.begin();
  pinMode(DHT_PIN, INPUT);
  
  // ⭐⭐ SETUP RELAY PIN ⭐⭐
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);  // Pastikan relay MATI saat startup
  
  // Get chip ID
  chipId = String((uint32_t)ESP.getEfuseMac(), HEX);
  chipId.toUpperCase();
  Serial.println("🆔 Chip ID: " + chipId);
  
  // WiFi Connection
  Serial.println("📶 Connecting to WiFi: " + String(ssid));
  WiFi.begin(ssid, password);
  
  int wifiAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 20) {
    delay(500);
    Serial.print(".");
    wifiAttempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("✅ WiFi connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("");
    Serial.println("❌ WiFi failed! Restarting...");
    delay(10000);
    ESP.restart();
  }
  
  // Hardware Detection
  Serial.println("Detecting DHT22 sensor...");
  delay(2000); 
  detectAllHardware();
  
  // MQTT Connection
  Serial.println("🔌 Setting up MQTT...");
  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);
  client.setSocketTimeout(30);
  
  Serial.println("=== SYSTEM READY ===");
  Serial.println("🔌 Relay initial state: OFF ⭕");
}

// ---------------- LOOP ----------------
void loop() {
  client.loop();
  
  // Check WiFi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi disconnected! Reconnecting...");
    WiFi.begin(ssid, password);
    delay(5000);
    return;
  }
  
  // Check MQTT
  if (!client.connected()) {
    mqttConnected = false;
    reconnect();
  }
  
  unsigned long now = millis();
  
  // Periodic hardware check
  if (now - lastHardwareCheck > hardwareCheckInterval) {
    lastHardwareCheck = now;
    Serial.println("🔍 Periodic hardware check...");
    detectAllHardware();
    sendHardwareStatus();
  }
  
  // Send heartbeat
  if (now - lastHeartbeat > heartbeatInterval) {
    lastHeartbeat = now;
    sendHeartbeat();
  }
  
  if (isStarted && mqttConnected) {
    if (now - lastSensorSend > sensorInterval) {
      lastSensorSend = now;
      readAndSendAllSensors();
    }
  }
  
  delay(100);
}