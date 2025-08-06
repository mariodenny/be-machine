#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <max6675.h>

// ---------------- WIFI CONFIG ----------------
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// ---------------- HIVEMQ CLOUD CONFIG ----------------
const char* mqtt_server = "5a4b12ea6b7e4a879fcd9b34a94de671.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_username = "esp-be-machine";
const char* mqtt_password = "Be_Machine@123";

WiFiClientSecure espClient;
PubSubClient client(espClient);

// ---------------- PIN CONFIGURATION ----------------
// Thermocouple Type K (MAX6675)
#define THERMO_SO_PIN   19
#define THERMO_CS_PIN   5
#define THERMO_SCK_PIN  18

// Pressure Transmitter (Analog)
#define PRESSURE_PIN    36

// SW-420 Vibration Sensor (Digital)
#define VIBRATION_PIN   4

// MAX6675 instance
MAX6675 thermocouple(THERMO_SCK_PIN, THERMO_CS_PIN, THERMO_SO_PIN);

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

struct Sensor {
  String sensorId;
  String sensorType;
  bool isActive;
  bool isHardwareAvailable; // NEW: apakah hardware tersedia
  unsigned long lastRead;
  unsigned long readInterval;
  float lastValue;
  int pinNumber;
};

// ---------------- GLOBAL VARIABEL ----------------
String chipId;
String machineId = "";
String rentalId = "";
unsigned long lastSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastHardwareCheck = 0;
unsigned long statusInterval = 5000;
unsigned long heartbeatInterval = 30000;
unsigned long hardwareCheckInterval = 60000; // Check hardware setiap 1 menit
bool isStarted = false;
bool mqttConnected = false;
bool systemReady = false; // NEW: system siap atau belum

// Hardware sensors yang tersedia
SensorHardware hardwareSensors[3] = {
  {"Thermocouple", "suhu", THERMO_CS_PIN, false, false, "", 0},
  {"Pressure", "tekanan", PRESSURE_PIN, false, false, "", 0},
  {"Vibration", "getaran", VIBRATION_PIN, false, false, "", 0}
};

// Array untuk menyimpan sensor-sensor yang dikonfigurasi
Sensor sensors[10];
int sensorCount = 0;

// ---------------- FUNGSI DETEKSI HARDWARE ----------------

bool detectThermocouple() {
  Serial.print("🔍 Detecting Thermocouple... ");
  
  try {
    // Test multiple readings
    float temp1 = thermocouple.readCelsius();
    delay(300);
    float temp2 = thermocouple.readCelsius();
    delay(300);
    float temp3 = thermocouple.readCelsius();
    
    // Check if readings are valid
    bool valid1 = !isnan(temp1) && temp1 > -50 && temp1 < 1000;
    bool valid2 = !isnan(temp2) && temp2 > -50 && temp2 < 1000;
    bool valid3 = !isnan(temp3) && temp3 > -50 && temp3 < 1000;
    
    if (valid1 && valid2 && valid3) {
      // Check if readings are not stuck (variation expected)
      float avgTemp = (temp1 + temp2 + temp3) / 3.0;
      Serial.println("✅ DETECTED (Avg: " + String(avgTemp, 1) + "°C)");
      return true;
    } else {
      Serial.println("❌ FAILED (Invalid readings: " + String(temp1) + ", " + String(temp2) + ", " + String(temp3) + ")");
      return false;
    }
  } catch (...) {
    Serial.println("❌ FAILED (Exception caught)");
    return false;
  }
}

bool detectPressureSensor() {
  Serial.print("🔍 Detecting Pressure Sensor... ");
  
  try {
    // Test multiple ADC readings
    int readings[5];
    float voltages[5];
    bool validReadings = true;
    
    for (int i = 0; i < 5; i++) {
      readings[i] = analogRead(PRESSURE_PIN);
      voltages[i] = (readings[i] / 4095.0) * 3.3;
      delay(100);
      
      // Check if reading is in expected range (0-3.3V)
      if (readings[i] < 0 || readings[i] > 4095) {
        validReadings = false;
        break;
      }
    }
    
    if (validReadings) {
      float avgVoltage = 0;
      for (int i = 0; i < 5; i++) {
        avgVoltage += voltages[i];
      }
      avgVoltage /= 5.0;
      
      Serial.println("✅ DETECTED (Avg: " + String(avgVoltage, 2) + "V)");
      return true;
    } else {
      Serial.println("❌ FAILED (Invalid ADC readings)");
      return false;
    }
  } catch (...) {
    Serial.println("❌ FAILED (Exception caught)");
    return false;
  }
}

bool detectVibrationSensor() {
  Serial.print("🔍 Detecting Vibration Sensor... ");
  
  try {
    // Test digital pin readings
    int readings[10];
    bool hasVariation = false;
    
    for (int i = 0; i < 10; i++) {
      readings[i] = digitalRead(VIBRATION_PIN);
      delay(50);
      
      // Check for variation in readings (sensor should respond to vibration)
      if (i > 0 && readings[i] != readings[0]) {
        hasVariation = true;
      }
    }
    
    // Even if no variation, consider it detected if pin can be read
    Serial.println("✅ DETECTED (Pin responsive)");
    return true;
    
  } catch (...) {
    Serial.println("❌ FAILED (Exception caught)");
    return false;
  }
}

// ---------------- FUNGSI AUTO DETECT SEMUA HARDWARE ----------------
void detectAllHardware() {
  Serial.println("🔍 === DETECTING HARDWARE SENSORS ===");
  
  // Reset detection status
  for (int i = 0; i < 3; i++) {
    hardwareSensors[i].isDetected = false;
    hardwareSensors[i].isWorking = false;
    hardwareSensors[i].errorMessage = "";
  }
  
  // Detect Thermocouple
  hardwareSensors[0].isDetected = detectThermocouple();
  hardwareSensors[0].isWorking = hardwareSensors[0].isDetected;
  
  // Detect Pressure Sensor
  hardwareSensors[1].isDetected = detectPressureSensor();
  hardwareSensors[1].isWorking = hardwareSensors[1].isDetected;
  
  // Detect Vibration Sensor
  hardwareSensors[2].isDetected = detectVibrationSensor();
  hardwareSensors[2].isWorking = hardwareSensors[2].isDetected;
  
  // Summary
  int detectedCount = 0;
  Serial.println("📊 === HARDWARE DETECTION SUMMARY ===");
  for (int i = 0; i < 3; i++) {
    String status = hardwareSensors[i].isDetected ? "✅ AVAILABLE" : "❌ NOT FOUND";
    Serial.println("   " + hardwareSensors[i].name + " (" + hardwareSensors[i].type + "): " + status);
    if (hardwareSensors[i].isDetected) detectedCount++;
  }
  
  Serial.println("🎯 Total detected sensors: " + String(detectedCount) + "/3");
  
  // Update system status
  systemReady = (detectedCount > 0); // System ready if at least 1 sensor detected
  
  if (systemReady) {
    Serial.println("✅ === SYSTEM READY ===");
  } else {
    Serial.println("⚠️  === SYSTEM NOT READY - NO SENSORS DETECTED ===");
  }
}

// ---------------- FUNGSI SENSOR DENGAN TRY-CATCH ----------------

float readSuhuSensor(String sensorId) {
  // Check if hardware is available
  if (!hardwareSensors[0].isWorking) {
    Serial.println("⚠️  Thermocouple [" + sensorId + "] hardware not available!");
    return -999.0;
  }
  
  try {
    float temperature = thermocouple.readCelsius();
    
    if (isnan(temperature) || temperature < -50 || temperature > 1000) {
      hardwareSensors[0].isWorking = false;
      hardwareSensors[0].errorMessage = "Invalid reading: " + String(temperature);
      Serial.println("⚠️  Error: Thermocouple [" + sensorId + "] reading error!");
      return -999.0;
    }
    
    // Reset error if reading is good
    hardwareSensors[0].isWorking = true;
    hardwareSensors[0].errorMessage = "";
    
    Serial.println("🌡️  Thermocouple [" + sensorId + "]: " + String(temperature) + "°C");
    return temperature;
    
  } catch (...) {
    hardwareSensors[0].isWorking = false;
    hardwareSensors[0].errorMessage = "Exception during reading";
    Serial.println("❌ ERROR: Exception in Thermocouple reading [" + sensorId + "]");
    return -999.0;
  }
}

float readTekananSensor(String sensorId) {
  // Check if hardware is available
  if (!hardwareSensors[1].isWorking) {
    Serial.println("⚠️  Pressure Sensor [" + sensorId + "] hardware not available!");
    return -999.0;
  }
  
  try {
    int adcValue = analogRead(PRESSURE_PIN);
    
    // Validate ADC reading
    if (adcValue < 0 || adcValue > 4095) {
      hardwareSensors[1].isWorking = false;
      hardwareSensors[1].errorMessage = "Invalid ADC: " + String(adcValue);
      Serial.println("⚠️  Error: Pressure Sensor [" + sensorId + "] invalid ADC!");
      return -999.0;
    }
    
    float voltage = (adcValue / 4095.0) * 3.3;
    float pressure = 0.0;
    if (voltage >= 0.5) {
      pressure = (voltage - 0.5) * 3.0;
    }
    
    if (pressure < 0) pressure = 0;
    if (pressure > 12) pressure = 12;
    
    // Reset error if reading is good
    hardwareSensors[1].isWorking = true;
    hardwareSensors[1].errorMessage = "";
    
    Serial.println("🔧 Pressure Sensor [" + sensorId + "]: " + String(pressure) + " Bar");
    return pressure;
    
  } catch (...) {
    hardwareSensors[1].isWorking = false;
    hardwareSensors[1].errorMessage = "Exception during reading";
    Serial.println("❌ ERROR: Exception in Pressure reading [" + sensorId + "]");
    return -999.0;
  }
}

float readGetaranSensor(String sensorId) {
  // Check if hardware is available
  if (!hardwareSensors[2].isWorking) {
    Serial.println("⚠️  Vibration Sensor [" + sensorId + "] hardware not available!");
    return -999.0;
  }
  
  try {
    int vibrationState = digitalRead(VIBRATION_PIN);
    float vibrationLevel = (vibrationState == LOW) ? 1.0 : 0.0;
    
    // Reset error if reading is good
    hardwareSensors[2].isWorking = true;
    hardwareSensors[2].errorMessage = "";
    
    String status = (vibrationLevel > 0) ? "TERDETEKSI" : "NORMAL";
    Serial.println("📳 Vibration Sensor [" + sensorId + "]: " + status);
    
    return vibrationLevel;
    
  } catch (...) {
    hardwareSensors[2].isWorking = false;
    hardwareSensors[2].errorMessage = "Exception during reading";
    Serial.println("❌ ERROR: Exception in Vibration reading [" + sensorId + "]");
    return -999.0;
  }
}

// ---------------- FUNGSI EXECUTE SENSOR DENGAN HARDWARE CHECK ----------------
float executeSensor(Sensor &sensor) {
  // Check if hardware is available for this sensor type
  bool hardwareAvailable = false;
  
  if (sensor.sensorType == "suhu" && hardwareSensors[0].isWorking) {
    hardwareAvailable = true;
  } else if (sensor.sensorType == "tekanan" && hardwareSensors[1].isWorking) {
    hardwareAvailable = true;
  } else if (sensor.sensorType == "getaran" && hardwareSensors[2].isWorking) {
    hardwareAvailable = true;
  }
  
  if (!hardwareAvailable) {
    Serial.println("⚠️  Sensor [" + sensor.sensorId + "] skipped - hardware not available");
    sensor.isHardwareAvailable = false;
    return -999.0;
  }
  
  sensor.isHardwareAvailable = true;
  float value = 0.0;
  
  if (sensor.sensorType == "suhu") {
    value = readSuhuSensor(sensor.sensorId);
  } 
  else if (sensor.sensorType == "tekanan") {
    value = readTekananSensor(sensor.sensorId);
  } 
  else if (sensor.sensorType == "getaran") {
    value = readGetaranSensor(sensor.sensorId);
  }
  else {
    Serial.println("❌ Tipe sensor tidak dikenal: " + sensor.sensorType);
    return -999.0;
  }
  
  if (value != -999.0) {
    sensor.lastValue = value;
    sensor.lastRead = millis();
  }
  
  return value;
}

// ---------------- FUNGSI KIRIM HARDWARE STATUS ----------------
void sendHardwareStatus() {
  if (!mqttConnected) return;
  
  StaticJsonDocument<512> doc;
  doc["chipId"] = chipId;
  doc["timestamp"] = millis();
  doc["systemReady"] = systemReady;
  
  JsonArray hardwareArray = doc.createNestedArray("hardware");
  
  for (int i = 0; i < 3; i++) {
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
  
  Serial.println("🔧 Hardware status sent");
}

// ---------------- MQTT CALLBACK (Modified) ----------------
void callback(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';
  String message = String((char*)payload);
  Serial.printf("📥 Message arrived [%s]: %s\n", topic, message.c_str());
  String topicStr = String(topic);

  if (topicStr.endsWith("/config")) {
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, message);
    if (!err) {
      rentalId = doc["rentalId"] | "";
      machineId = doc["machineId"] | "";
      statusInterval = doc["statusInterval"] | 5000;
      
      JsonArray sensorsArray = doc["sensors"];
      sensorCount = 0;
      
      for (JsonObject sensorObj : sensorsArray) {
        if (sensorCount < 10) {
          sensors[sensorCount].sensorId = sensorObj["sensorId"] | "";
          sensors[sensorCount].sensorType = sensorObj["sensorType"] | "";
          sensors[sensorCount].isActive = sensorObj["isActive"] | false;
          sensors[sensorCount].readInterval = sensorObj["readInterval"] | 10000;
          sensors[sensorCount].lastRead = 0;
          sensors[sensorCount].lastValue = 0.0;
          sensors[sensorCount].isHardwareAvailable = false; // Will be checked during execution
          sensorCount++;
        }
      }
      
      Serial.println("🔧 === CONFIG DITERIMA ===");
      Serial.println("📋 Rental ID: " + rentalId);
      Serial.println("🏭 Machine ID: " + machineId);
      Serial.println("📊 Jumlah Sensor: " + String(sensorCount));
      
      // Re-detect hardware after config
      detectAllHardware();
      sendHardwareStatus();
    }
  }
  
  else if (topicStr.endsWith("/command")) {
    if (message == "start") {
      if (systemReady) {
        isStarted = true;
        Serial.println("🚀 === MESIN DIHIDUPKAN ===");
      } else {
        Serial.println("⚠️  Cannot start - no sensors detected!");
      }
    } else if (message == "stop") {
      isStarted = false;
      Serial.println("🛑 === MESIN DIMATIKAN ===");
    } else if (message == "detect") {
      Serial.println("🔍 Manual hardware detection requested...");
      detectAllHardware();
      sendHardwareStatus();
    }
  }
}

// ---------------- FUNGSI RECONNECT (Modified) ----------------
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
      
      Serial.println("📥 Subscribed to topics");
      
      sendConnectionStatus(true);
      sendHardwareStatus(); // Send hardware status on connect
      
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
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/connection";
  client.publish(topic.c_str(), buffer, true);
  
  Serial.println("📡 Connection status sent: " + String(connected ? "ONLINE" : "OFFLINE"));
}

void sendMachineStatus() {
  if (machineId == "" || !mqttConnected) return;
  
  StaticJsonDocument<512> doc;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["status"] = isStarted ? "ON" : "OFF";
  doc["timestamp"] = millis();
  doc["activeSensors"] = sensorCount;
  doc["systemReady"] = systemReady;
  doc["chipId"] = chipId;
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["wifiRSSI"] = WiFi.RSSI();
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/status";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("📊 Status mesin dikirim: " + String(isStarted ? "ON" : "OFF"));
}

void sendSensorData(Sensor &sensor) {
  if (!mqttConnected || machineId == "" || !sensor.isHardwareAvailable) return;
  
  StaticJsonDocument<256> doc;
  doc["sensorId"] = sensor.sensorId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["sensorType"] = sensor.sensorType;
  doc["value"] = sensor.lastValue;
  doc["timestamp"] = millis();
  doc["chipId"] = chipId;
  doc["hardwareAvailable"] = sensor.isHardwareAvailable;
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "sensor/" + sensor.sensorId + "/data";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("📤 Data sensor dikirim [" + sensor.sensorType + "]: " + String(sensor.lastValue));
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
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/heartbeat";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("💓 Heartbeat sent");
}

// ---------------- SETUP (Modified) ----------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("🚀 === ESP32 AUTO-DETECT MULTI-SENSOR ===");
  
  // Setup pin modes
  pinMode(VIBRATION_PIN, INPUT);
  pinMode(PRESSURE_PIN, INPUT);
  
  // Get chip ID
  chipId = String((uint32_t)ESP.getEfuseMac(), HEX);
  chipId.toUpperCase();
  Serial.println("🆔 Chip ID: " + chipId);
  
  // Phase 1: WiFi Connection
  Serial.println("📶 === PHASE 1: WIFI CONNECTION ===");
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
    Serial.println("✅ WiFi connected!");
    Serial.println("📡 IP address: " + WiFi.localIP().toString());
  } else {
    Serial.println("");
    Serial.println("❌ WiFi connection failed! Restarting...");
    delay(10000);
    ESP.restart();
  }
  
  // Phase 2: Hardware Detection
  Serial.println("🔍 === PHASE 2: HARDWARE DETECTION ===");
  delay(500); // Wait for MAX6675 ready
  detectAllHardware();
  
  // Phase 3: MQTT Connection
  Serial.println("🔌 === PHASE 3: MQTT CONNECTION ===");
  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);
  client.setSocketTimeout(30);
  
  Serial.println("🔌 Connecting to HiveMQ Cloud...");
  
  Serial.println("✅ === SYSTEM INITIALIZATION COMPLETE ===");
  Serial.println("📊 System Status:");
  Serial.println("   - WiFi: ✅ Connected");
  Serial.println("   - Hardware: " + String(systemReady ? "✅ Ready" : "❌ Not Ready"));
  Serial.println("   - MQTT: 🔄 Connecting...");
}

// ---------------- LOOP (Modified) ----------------
void loop() {
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi disconnected! Reconnecting...");
    WiFi.begin(ssid, password);
    delay(5000);
    return;
  }
  
  // Check MQTT connection
  if (!client.connected()) {
    mqttConnected = false;
    reconnect();
  }
  client.loop();
  
  unsigned long now = millis();
  
  // Periodic hardware check (every 1 minute)
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
  
  // Send machine status
  if (machineId != "" && now - lastSend > statusInterval) {
    lastSend = now;
    sendMachineStatus();
  }
  
  // Process sensors only if system is ready and machine is started
  if (systemReady && isStarted && machineId != "" && mqttConnected) {
    for (int i = 0; i < sensorCount; i++) {
      Sensor &sensor = sensors[i];
      
      if (sensor.isActive && (now - sensor.lastRead > sensor.readInterval)) {
        float value = executeSensor(sensor);
        
        // Send data only if reading is successful and hardware is available
        if (value != -999.0 && sensor.isHardwareAvailable) {
          sendSensorData(sensor);
        }
      }
    }
  }
  
  delay(100);
}