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

// ---------------- API CONFIG ----------------
const char* api_server = "103.197.188.191";
const int api_port = 5000;
const String api_base_path = "/api/machine";

WiFiClientSecure espClient;
PubSubClient client(espClient);
WiFiClient httpClient;

// ---------------- DHT22 CONFIG ----------------
#define DHT_PIN 18       // GPIO 18 untuk DHT22
#define DHT_TYPE DHT22   // Tipe sensor DHT22

// ---------------- RELAY CONFIG ----------------
#define RELAY_PIN 19     // GPIO 19 untuk Relay

// ---------------- BUZZER CONFIG ----------------
#define BUZZER_PIN 21    // GPIO 21 untuk Buzzer

DHT dht(DHT_PIN, DHT_TYPE);

// ---------------- SENSOR TYPE ENUM ----------------
enum SensorType {
  SENSOR_NONE,
  SENSOR_DHT22_TEMP,
  SENSOR_DHT22_HUMID,
  SENSOR_THERMOCOUPLE,
  SENSOR_MPU6050,
  SENSOR_PRESSURE
};

// ---------------- THRESHOLD STRUCTURE ----------------
struct ThresholdStandard {
  float normal_min;
  float normal_max;
  float warning_min;
  float warning_max;
  String unit;
  String sensorType;  // Tipe sensor untuk API
};

// Threshold untuk berbagai tipe sensor
ThresholdStandard thresholds[] = {
  {800, 900, 925, 950, "°C", "thermocouple"},      // thermocouple (oven-hardening)
  {1.0, 2.5, 3.5, 4.5, "mm/s", "vibration"},       // mpu6050 (getaran)
  {5.0, 6.5, 7.5, 8.0, "bar", "pressure"},         // pressure (pneumatic)
  {20, 30, 35, 40, "°C", "suhu"},                  // dht22 suhu (normal)
  {40, 70, 75, 85, "%", "kelembaban"},             // dht22 kelembaban
};

// ---------------- SENSOR HARDWARE STRUCTURE ----------------
struct SensorHardware {
  String name;
  String sensorId;
  SensorType type;
  int pin;
  bool isDetected;
  bool isWorking;
  String errorMessage;
  int thresholdIndex;
  unsigned long lastCheck;
};

// ---------------- WARNING STATUS ----------------
enum WarningStatus {
  STATUS_NORMAL,
  STATUS_WARNING,
  STATUS_DANGER,
  STATUS_CRITICAL
};

// ---------------- GLOBAL VARIABEL ----------------
String chipId;
String machineId = "";
String rentalId = "";
unsigned long lastSensorSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastHardwareCheck = 0;
unsigned long lastApiUpdate = 0;
unsigned long lastBuzzerUpdate = 0;
unsigned long sensorInterval = 5000;    // Kirim data sensor setiap 5 detik
unsigned long heartbeatInterval = 30000;
unsigned long hardwareCheckInterval = 60000;
unsigned long apiUpdateInterval = 10000; // Update API setiap 10 detik
unsigned long buzzerInterval = 1000;     // Buzzer update setiap 1 detik
bool isStarted = false;
bool mqttConnected = false;
bool systemReady = false;
bool relayState = false;  // Status relay: false = OFF, true = ON
bool buzzerState = false; // Status buzzer
WarningStatus globalWarningStatus = STATUS_NORMAL;

// Hardware sensors yang tersedia
SensorHardware hardwareSensors[2] = {
  {"DHT22 Temperature", "dht22_suhu", SENSOR_DHT22_TEMP, DHT_PIN, false, false, "", 3, 0},
  {"DHT22 Humidity", "dht22_kelembaban", SENSOR_DHT22_HUMID, DHT_PIN, false, false, "", 4, 0}
};

// ---------------- FUNGSI BUZZER CONTROL ----------------
void setBuzzer(bool state) {
  buzzerState = state;
  digitalWrite(BUZZER_PIN, state ? HIGH : LOW);
  
  if (state) {
    Serial.println("🔊 Buzzer: ON 🔊");
  } else {
    Serial.println("🔇 Buzzer: OFF");
  }
}

void controlBuzzerByStatus(WarningStatus status) {
  unsigned long now = millis();
  static unsigned long lastBuzzerToggle = 0;
  static bool buzzerToggleState = false;
  
  switch (status) {
    case STATUS_NORMAL:
      setBuzzer(false);
      break;
      
    case STATUS_WARNING:
      // Buzzer slow beep (1 detik on, 1 detik off)
      if (now - lastBuzzerToggle > 1000) {
        buzzerToggleState = !buzzerToggleState;
        setBuzzer(buzzerToggleState);
        lastBuzzerToggle = now;
      }
      break;
      
    case STATUS_DANGER:
      // Buzzer medium beep (500ms on, 500ms off)
      if (now - lastBuzzerToggle > 500) {
        buzzerToggleState = !buzzerToggleState;
        setBuzzer(buzzerToggleState);
        lastBuzzerToggle = now;
      }
      break;
      
    case STATUS_CRITICAL:
      // Buzzer fast continuous beep
      setBuzzer(true);
      break;
  }
}

// ---------------- FUNGSI DETEKSI STATUS WARNING ----------------
WarningStatus checkWarningStatus(float value, int thresholdIndex) {
  if (thresholdIndex < 0 || thresholdIndex >= 5) return STATUS_NORMAL;
  
  ThresholdStandard threshold = thresholds[thresholdIndex];
  
  if (value >= threshold.warning_max || value <= threshold.warning_min) {
    return STATUS_DANGER;
  } else if (value >= threshold.normal_max || value <= threshold.normal_min) {
    return STATUS_WARNING;
  }
  
  return STATUS_NORMAL;
}

String getStatusText(WarningStatus status) {
  switch (status) {
    case STATUS_NORMAL: return "normal";
    case STATUS_WARNING: return "warning";
    case STATUS_DANGER: return "danger";
    case STATUS_CRITICAL: return "critical";
    default: return "unknown";
  }
}

String getStatusColor(WarningStatus status) {
  switch (status) {
    case STATUS_NORMAL: return "#4CAF50";
    case STATUS_WARNING: return "#FF9800";
    case STATUS_DANGER: return "#F44336";
    case STATUS_CRITICAL: return "#D32F2F";
    default: return "#9E9E9E";
  }
}

// ---------------- FUNGSI UPDATE KE API ----------------
void updateSensorValueToAPI(String sensorType, float value, WarningStatus status, String unit) {
  if (machineId == "" || !WiFi.isConnected()) {
    return;
  }
  
  Serial.println("🌐 Updating API for sensor: " + sensorType + " = " + String(value) + unit);
  
  // Create JSON document
  StaticJsonDocument<512> doc;
  doc["sensorValue"] = value;
  doc["status"] = getStatusText(status);
  doc["sensorType"] = sensorType;
  doc["unit"] = unit;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  // Prepare HTTP request
  String url = api_base_path + "/" + machineId + "/real-time-status";
  String host = String(api_server) + ":" + String(api_port);
  
  Serial.println("📡 Sending to: " + host + url);
  
  httpClient.setInsecure(); // For HTTPS, use with caution
  if (httpClient.connect(api_server, api_port)) {
    httpClient.println("POST " + url + " HTTP/1.1");
    httpClient.println("Host: " + host);
    httpClient.println("Content-Type: application/json");
    httpClient.println("Connection: close");
    httpClient.println("Content-Length: " + String(jsonString.length()));
    httpClient.println();
    httpClient.println(jsonString);
    
    // Wait for response
    unsigned long timeout = millis();
    while (httpClient.available() == 0) {
      if (millis() - timeout > 5000) {
        Serial.println("❌ API Request timeout");
        httpClient.stop();
        return;
      }
    }
    
    // Read response
    String response = "";
    while (httpClient.available()) {
      response += httpClient.readString();
    }
    
    Serial.println("✅ API Response: " + response.substring(0, 100)); // Print first 100 chars
    
    httpClient.stop();
  } else {
    Serial.println("❌ Failed to connect to API server");
  }
}

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
  WarningStatus highestStatus = STATUS_NORMAL;
  
  // ⭐⭐ BACA & KIRIM DATA DHT22 (SUHU & KELEMBABAN) ⭐⭐
  if (hardwareSensors[0].isWorking) {
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();
    
    if (!isnan(temperature) && !isnan(humidity)) {
      // Check warning status untuk suhu
      WarningStatus tempStatus = checkWarningStatus(temperature, hardwareSensors[0].thresholdIndex);
      if (tempStatus > highestStatus) highestStatus = tempStatus;
      
      // Check warning status untuk kelembaban
      WarningStatus humStatus = checkWarningStatus(humidity, hardwareSensors[1].thresholdIndex);
      if (humStatus > highestStatus) highestStatus = humStatus;
      
      // Kirim data suhu dengan status warning
      sendSensorData("dht22_suhu", "suhu", temperature, "°C", tempStatus);
      
      // Kirim data kelembaban dengan status warning
      sendSensorData("dht22_kelembaban", "kelembaban", humidity, "%", humStatus);
      
      // Update ke API
      updateSensorValueToAPI("suhu", temperature, tempStatus, "°C");
      updateSensorValueToAPI("kelembaban", humidity, humStatus, "%");
      
      Serial.println("📤 Sent: " + String(temperature, 1) + "°C (" + getStatusText(tempStatus) + 
                    "), " + String(humidity, 1) + "% (" + getStatusText(humStatus) + ")");
    } else {
      Serial.println("❌ DHT22 reading invalid");
      hardwareSensors[0].isWorking = false;
      hardwareSensors[0].errorMessage = "Invalid readings";
    }
  } else {
    Serial.println("⚠️  DHT22 not working, skip reading");
  }
  
  // Update global warning status dan kontrol buzzer
  globalWarningStatus = highestStatus;
  Serial.println("🚨 Global Warning Status: " + getStatusText(globalWarningStatus));
}

// ⭐⭐ FUNGSI KIRIM DATA SENSOR DENGAN WARNING STATUS ⭐⭐
void sendSensorData(String sensorId, String sensorType, float value, String unit, WarningStatus status) {
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
  doc["relayState"] = relayState;
  doc["warningStatus"] = getStatusText(status);
  doc["statusColor"] = getStatusColor(status);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "sensor/" + sensorId + "/data";
  
  if (client.publish(topic.c_str(), buffer, 0)) {
    Serial.println("✅ Sent: " + sensorType + " = " + String(value) + unit + 
                  " | Status: " + getStatusText(status) + " | Relay: " + String(relayState ? "ON" : "OFF"));
  } else {
    Serial.println("❌ Failed to send: " + sensorType);
  }
}

// ---------------- FUNGSI AUTO DETECT SEMUA HARDWARE ----------------
void detectAllHardware() {
  Serial.println("🔍 === DETECTING HARDWARE SENSORS ===");
  
  // Reset detection status
  for (int i = 0; i < 2; i++) {
    hardwareSensors[i].isDetected = false;
    hardwareSensors[i].isWorking = false;
    hardwareSensors[i].errorMessage = "";
  }
  
  // Detect DHT22 Sensor (satu sensor, dua parameter)
  bool dhtDetected = detectDHTSensor();
  hardwareSensors[0].isDetected = dhtDetected; // Temperature
  hardwareSensors[0].isWorking = dhtDetected;
  hardwareSensors[1].isDetected = dhtDetected; // Humidity
  hardwareSensors[1].isWorking = dhtDetected;
  
  // Summary
  int detectedCount = 0;
  Serial.println("📊 === HARDWARE DETECTION SUMMARY ===");
  for (int i = 0; i < 2; i++) {
    String status = hardwareSensors[i].isDetected ? "✅ AVAILABLE" : "❌ NOT FOUND";
    Serial.println("   " + hardwareSensors[i].name + " (" + hardwareSensors[i].sensorId + "): " + status);
    if (hardwareSensors[i].isDetected) detectedCount++;
  }
  
  Serial.println("🎯 Total detected sensors: " + String(detectedCount) + "/2");
  
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
  doc["relayState"] = relayState;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  JsonArray hardwareArray = doc.createNestedArray("hardware");
  
  for (int i = 0; i < 2; i++) {
    JsonObject hw = hardwareArray.createNestedObject();
    hw["name"] = hardwareSensors[i].name;
    hw["sensorId"] = hardwareSensors[i].sensorId;
    hw["type"] = hardwareSensors[i].type;
    hw["pin"] = hardwareSensors[i].pin;
    hw["detected"] = hardwareSensors[i].isDetected;
    hw["working"] = hardwareSensors[i].isWorking;
    hw["error"] = hardwareSensors[i].errorMessage;
    hw["thresholdIndex"] = hardwareSensors[i].thresholdIndex;
  }
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/hardware";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("🔧 Hardware status sent | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Global Status: " + getStatusText(globalWarningStatus));
}

// ---------------- MQTT CALLBACK ----------------
void callback(char* topic, byte* payload, unsigned int length) {
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
          setBuzzer(false); // Matikan buzzer saat start
          
          Serial.println("🚀 === RENTAL STARTED ===");
          Serial.println("📋 Rental ID: " + rentalId);
          Serial.println("🏭 Machine ID: " + machineId);
          Serial.println("🔌 Relay: ON ⚡");
          Serial.println("🔇 Buzzer: OFF");
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
        setBuzzer(false); // Matikan buzzer saat stop
        
        Serial.println("🛑 === RENTAL STOPPED via stopRental ===");
        Serial.println("🔌 Relay: OFF ⭕");
        Serial.println("🔇 Buzzer: OFF");
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
          setBuzzer(false);
          Serial.println("🛑 === RENTAL STOPPED via command JSON ===");
          sendRentalReport(true, "Rental stopped via command - Relay OFF");
        }
      }
    } 
    if (message == "start") {
      if (systemReady) {
        isStarted = true;
        setRelay(true);
        setBuzzer(false);
        
        Serial.println("🚀 === MESIN DIHIDUPKAN ===");
        Serial.println("🔌 Relay: ON ⚡");
        Serial.println("🔇 Buzzer: OFF");
        sendRentalReport(true, "Machine started via command - Relay ON");
      } else {
        Serial.println("⚠️  Cannot start - no sensors detected!");
        sendRentalReport(false, "Cannot start - system not ready");
      }
    } else if (message == "stop") {
      isStarted = false;
      setRelay(false);
      setBuzzer(false);
      
      Serial.println("🛑 === MESIN DIMATIKAN ===");
      Serial.println("🔌 Relay: OFF ⭕");
      Serial.println("🔇 Buzzer: OFF");
      sendRentalReport(true, "Machine stopped via command - Relay OFF");
    } else if (message == "detect") {
      Serial.println("🔍 Manual hardware detection requested...");
      detectAllHardware();
      sendHardwareStatus();
    } else if (message == "relay_on") {
      setRelay(true);
      Serial.println("🔌 Manual: Relay ON ⚡");
    } else if (message == "relay_off") {
      setRelay(false);
      Serial.println("🔌 Manual: Relay OFF ⭕");
    } else if (message == "buzzer_test") {
      Serial.println("🔊 Manual: Buzzer test");
      setBuzzer(true);
      delay(1000);
      setBuzzer(false);
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
  doc["relayState"] = relayState;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/report";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("📊 Rental report sent: " + message + " | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Global Status: " + getStatusText(globalWarningStatus));
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
  doc["relayState"] = relayState;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/connection";
  client.publish(topic.c_str(), buffer, true);
  
  Serial.println("📡 Connection status sent: " + String(connected ? "ONLINE" : "OFFLINE") + 
                " | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Global Status: " + getStatusText(globalWarningStatus));
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
  doc["relayState"] = relayState;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/heartbeat";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("💓 Heartbeat sent | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Global Status: " + getStatusText(globalWarningStatus));
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("🚀 === ESP32 DHT22 SENSOR + RELAY + BUZZER CONTROL ===");
  
  // Setup DHT22
  dht.begin();
  pinMode(DHT_PIN, INPUT);
  
  // ⭐⭐ SETUP RELAY PIN ⭐⭐
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);  // Pastikan relay MATI saat startup
  
  // ⭐⭐ SETUP BUZZER PIN ⭐⭐
  pinMode(BUZZER_PIN, OUTPUT);
  setBuzzer(false); // Pastikan buzzer MATI saat startup
  
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
  Serial.println("🔇 Buzzer initial state: OFF");
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
  
  // Control buzzer based on warning status
  if (now - lastBuzzerUpdate > buzzerInterval) {
    lastBuzzerUpdate = now;
    controlBuzzerByStatus(globalWarningStatus);
  }
  
  if (isStarted && mqttConnected) {
    if (now - lastSensorSend > sensorInterval) {
      lastSensorSend = now;
      readAndSendAllSensors();
    }
  }
  
  delay(100);
}