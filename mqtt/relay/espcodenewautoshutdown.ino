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

// ---------------- SENSOR TAMBAHAN CONFIG ----------------
#define THERMOCOUPLE_PIN 34    // GPIO 34 untuk Thermocouple (Analog)
#define VIBRATION_PIN 35       // GPIO 35 untuk Vibration Sensor (Analog) 
#define PRESSURE_PIN 32        // GPIO 32 untuk Pressure Sensor (Analog)

DHT dht(DHT_PIN, DHT_TYPE);

// ---------------- SENSOR TYPE ENUM ----------------
enum SensorType {
  SENSOR_NONE,
  SENSOR_DHT22_TEMP,
  SENSOR_DHT22_HUMID,
  SENSOR_THERMOCOUPLE,
  SENSOR_VIBRATION,
  SENSOR_PRESSURE
};

// ---------------- THRESHOLD STRUCTURE ----------------
struct ThresholdStandard {
  float normal_min;
  float normal_max;
  float warning_min;
  float warning_max;
  float danger_min;
  float danger_max;
  String unit;
  String sensorType;
  bool autoShutdown;  // Auto matikan relay jika danger
};

// Threshold untuk berbagai tipe sensor
ThresholdStandard thresholds[] = {
  // thermocouple (oven-hardening) - AUTO SHUTDOWN jika danger
  {800, 900, 901, 925, 926, 950, "°C", "thermocouple", true},
  // vibration sensor  
  {1.0, 2.5, 2.6, 3.5, 3.6, 4.5, "mm/s", "vibration", false},
  // pressure sensor
  {5.0, 6.5, 6.6, 7.5, 7.6, 8.0, "bar", "pressure", false},
  // dht22 suhu - AUTO SHUTDOWN jika danger
  {20, 30, 31, 35, 36, 40, "°C", "suhu", true},
  // dht22 kelembaban
  {40, 70, 71, 75, 76, 85, "%", "kelembaban", false},
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
  float lastValue;
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
unsigned long sensorInterval = 5000;
unsigned long heartbeatInterval = 30000;
unsigned long hardwareCheckInterval = 60000;
unsigned long apiUpdateInterval = 10000;
unsigned long buzzerInterval = 1000;
bool isStarted = false;
bool mqttConnected = false;
bool systemReady = false;
bool relayState = false;
bool buzzerState = false;
bool emergencyShutdown = false;  // Status emergency shutdown
WarningStatus globalWarningStatus = STATUS_NORMAL;

// Hardware sensors yang tersedia
SensorHardware hardwareSensors[5] = {
  {"DHT22 Temperature", "dht22_suhu", SENSOR_DHT22_TEMP, DHT_PIN, false, false, "", 3, 0, 0},
  {"DHT22 Humidity", "dht22_kelembaban", SENSOR_DHT22_HUMID, DHT_PIN, false, false, "", 4, 0, 0},
  {"Thermocouple", "thermocouple", SENSOR_THERMOCOUPLE, THERMOCOUPLE_PIN, false, false, "", 0, 0, 0},
  {"Vibration Sensor", "vibration_sensor", SENSOR_VIBRATION, VIBRATION_PIN, false, false, "", 1, 0, 0},
  {"Pressure Sensor", "pressure_sensor", SENSOR_PRESSURE, PRESSURE_PIN, false, false, "", 2, 0, 0}
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
      // Buzzer slow beep (2 detik on, 2 detik off)
      if (now - lastBuzzerToggle > 2000) {
        buzzerToggleState = !buzzerToggleState;
        setBuzzer(buzzerToggleState);
        lastBuzzerToggle = now;
      }
      break;
      
    case STATUS_DANGER:
      // Buzzer medium beep (1 detik on, 1 detik off)
      if (now - lastBuzzerToggle > 1000) {
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
  
  if (value >= threshold.danger_max || value <= threshold.danger_min) {
    return STATUS_DANGER;
  } else if (value >= threshold.warning_max || value <= threshold.warning_min) {
    return STATUS_WARNING;
  } else if (value >= threshold.normal_max || value <= threshold.normal_min) {
    return STATUS_NORMAL;
  }
  
  return STATUS_NORMAL;
}

// ---------------- FUNGSI AUTO SHUTDOWN CHECK ----------------
void checkAutoShutdown(float value, int thresholdIndex, String sensorName) {
  if (thresholdIndex < 0 || thresholdIndex >= 5) return;
  
  ThresholdStandard threshold = thresholds[thresholdIndex];
  
  // Jika nilai mencapai danger dan autoShutdown enabled
  if ((value >= threshold.danger_max || value <= threshold.danger_min) && threshold.autoShutdown) {
    if (relayState && !emergencyShutdown) {
      emergencyShutdown = true;
      setRelay(false);
      
      Serial.println("🚨 🚨 🚨 EMERGENCY SHUTDOWN TRIGGERED! 🚨 🚨 🚨");
      Serial.println("🔌 Relay: AUTO OFF ⭕");
      Serial.println("📛 Reason: " + sensorName + " reached DANGER level: " + String(value) + threshold.unit);
      
      // Kirim laporan emergency
      sendEmergencyShutdownReport(sensorName, value, threshold.unit);
    }
  }
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
  
  StaticJsonDocument<512> doc;
  doc["sensorValue"] = value;
  doc["status"] = getStatusText(status);
  doc["sensorType"] = sensorType;
  doc["unit"] = unit;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = api_base_path + "/" + machineId + "/real-time-status";
  String host = String(api_server) + ":" + String(api_port);
  
  Serial.println("📡 Sending to: " + host + url);
  
  // httpClient.setInsecure();
  if (httpClient.connect(api_server, api_port)) {
    httpClient.println("POST " + url + " HTTP/1.1");
    httpClient.println("Host: " + host);
    httpClient.println("Content-Type: application/json");
    httpClient.println("Connection: close");
    httpClient.println("Content-Length: " + String(jsonString.length()));
    httpClient.println();
    httpClient.println(jsonString);
    
    unsigned long timeout = millis();
    while (httpClient.available() == 0) {
      if (millis() - timeout > 5000) {
        Serial.println("❌ API Request timeout");
        httpClient.stop();
        return;
      }
    }
    
    String response = "";
    while (httpClient.available()) {
      response += httpClient.readString();
    }
    
    Serial.println("✅ API Response: " + response.substring(0, 100));
    
    httpClient.stop();
  } else {
    Serial.println("❌ Failed to connect to API server");
  }
}

// ---------------- FUNGSI BACA SENSOR TAMBAHAN ----------------
float readThermocouple() {
  // Baca analog value dari thermocouple
  int analogValue = analogRead(THERMOCOUPLE_PIN);
  // Konversi ke temperature (sesuaikan dengan sensor Anda)
  float voltage = analogValue * (3.3 / 4095.0);
  float temperature = (voltage - 0.5) * 100.0; // Contoh konversi untuk T-type thermocouple
  return temperature;
}

float readVibration() {
  // Baca analog value dari vibration sensor
  int analogValue = analogRead(VIBRATION_PIN);
  // Konversi ke mm/s (sesuaikan dengan sensor Anda)
  float vibration = analogValue * (10.0 / 4095.0); // 0-10 mm/s
  return vibration;
}

float readPressure() {
  // Baca analog value dari pressure sensor
  int analogValue = analogRead(PRESSURE_PIN);
  // Konversi ke bar (sesuaikan dengan sensor Anda)
  float pressure = analogValue * (10.0 / 4095.0); // 0-10 bar
  return pressure;
}

// ---------------- FUNGSI DETEKSI SENSOR TAMBAHAN ----------------
bool detectThermocouple() {
  Serial.print("🔍 Detecting Thermocouple... ");
  float temp1 = readThermocouple();
  delay(100);
  float temp2 = readThermocouple();
  
  bool valid1 = !isnan(temp1) && temp1 > -50 && temp1 < 1000;
  bool valid2 = !isnan(temp2) && temp2 > -50 && temp2 < 1000;
  
  if (valid1 && valid2) {
    Serial.println("✅ DETECTED (" + String(temp1, 1) + "°C)");
    return true;
  } else {
    Serial.println("❌ NOT DETECTED");
    return false;
  }
}

bool detectVibrationSensor() {
  Serial.print("🔍 Detecting Vibration Sensor... ");
  float vib1 = readVibration();
  delay(100);
  float vib2 = readVibration();
  
  bool valid1 = !isnan(vib1) && vib1 >= 0 && vib1 <= 10;
  bool valid2 = !isnan(vib2) && vib2 >= 0 && vib2 <= 10;
  
  if (valid1 && valid2) {
    Serial.println("✅ DETECTED (" + String(vib1, 1) + " mm/s)");
    return true;
  } else {
    Serial.println("❌ NOT DETECTED");
    return false;
  }
}

bool detectPressureSensor() {
  Serial.print("🔍 Detecting Pressure Sensor... ");
  float press1 = readPressure();
  delay(100);
  float press2 = readPressure();
  
  bool valid1 = !isnan(press1) && press1 >= 0 && press1 <= 10;
  bool valid2 = !isnan(press2) && press2 >= 0 && press2 <= 10;
  
  if (valid1 && valid2) {
    Serial.println("✅ DETECTED (" + String(press1, 1) + " bar)");
    return true;
  } else {
    Serial.println("❌ NOT DETECTED");
    return false;
  }
}

// ---------------- FUNGSI CONTROL RELAY ----------------
void setRelay(bool state) {
  // Jika emergency shutdown aktif, relay tidak bisa dinyalakan
  if (emergencyShutdown && state) {
    Serial.println("🚨 Relay cannot be turned ON - Emergency Shutdown Active!");
    return;
  }
  
  relayState = state;
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
  
  Serial.println("🔌 Relay: " + String(state ? "ON ⚡" : "OFF ⭕"));
  
  // Reset emergency shutdown jika relay dimatikan manual
  if (!state && emergencyShutdown) {
    emergencyShutdown = false;
    Serial.println("🔄 Emergency Shutdown Reset");
  }
  
  // Kirim status relay ke MQTT
  if (mqttConnected) {
    sendRelayStatus();
  }
}

// ---------------- FUNGSI KIRIM EMERGENCY REPORT ----------------
void sendEmergencyShutdownReport(String sensorName, float value, String unit) {
  if (!mqttConnected || machineId == "") return;
  
  StaticJsonDocument<512> doc;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["chipId"] = chipId;
  doc["status"] = "emergency";
  doc["message"] = "EMERGENCY SHUTDOWN: " + sensorName + " reached " + String(value) + unit;
  doc["timestamp"] = millis();
  doc["sensorName"] = sensorName;
  doc["sensorValue"] = value;
  doc["unit"] = unit;
  doc["relayState"] = false;
  doc["emergencyShutdown"] = true;
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/emergency";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("🚨 Emergency shutdown report sent!");
}

// ---------------- FUNGSI KIRIM STATUS RELAY ----------------
void sendRelayStatus() {
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["relayState"] = relayState;
  doc["emergencyShutdown"] = emergencyShutdown;
  doc["timestamp"] = millis();
  doc["isStarted"] = isStarted;
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/relay";
  if (client.publish(topic.c_str(), buffer, 0)) {
    Serial.println("📤 Relay status sent: " + String(relayState ? "ON" : "OFF") + 
                  " | Emergency: " + String(emergencyShutdown ? "YES" : "NO"));
  } else {
    Serial.println("❌ Failed to send relay status");
  }
}

// ---------------- FUNGSI DETEKSI DHT22 ----------------
bool detectDHTSensor() {
  Serial.print("🔍 Detecting DHT22 Sensor... ");
  
  try {
    float temp1 = dht.readTemperature();
    float hum1 = dht.readHumidity();
    delay(2000);
    float temp2 = dht.readTemperature();
    float hum2 = dht.readHumidity();
    
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
  
  // Baca semua sensor yang terdeteksi
  for (int i = 0; i < 5; i++) {
    if (hardwareSensors[i].isWorking) {
      float value = 0;
      String sensorType = "";
      String unit = "";
      
      // Baca nilai sensor berdasarkan jenis
      switch (hardwareSensors[i].type) {
        case SENSOR_DHT22_TEMP:
          value = dht.readTemperature();
          sensorType = "suhu";
          unit = "°C";
          break;
        case SENSOR_DHT22_HUMID:
          value = dht.readHumidity();
          sensorType = "kelembaban";
          unit = "%";
          break;
        case SENSOR_THERMOCOUPLE:
          value = readThermocouple();
          sensorType = "thermocouple";
          unit = "°C";
          break;
        case SENSOR_VIBRATION:
          value = readVibration();
          sensorType = "vibration";
          unit = "mm/s";
          break;
        case SENSOR_PRESSURE:
          value = readPressure();
          sensorType = "pressure";
          unit = "bar";
          break;
        default:
          continue;
      }
      
      if (!isnan(value)) {
        hardwareSensors[i].lastValue = value;
        
        // Check warning status
        WarningStatus status = checkWarningStatus(value, hardwareSensors[i].thresholdIndex);
        if (status > highestStatus) highestStatus = status;
        
        // Check auto shutdown
        checkAutoShutdown(value, hardwareSensors[i].thresholdIndex, hardwareSensors[i].name);
        
        // Kirim data sensor
        sendSensorData(hardwareSensors[i].sensorId, sensorType, value, unit, status);
        
        // Update ke API
        updateSensorValueToAPI(sensorType, value, status, unit);
        
        Serial.println("📤 " + hardwareSensors[i].name + ": " + String(value) + unit + 
                      " (" + getStatusText(status) + ")");
      } else {
        Serial.println("❌ " + hardwareSensors[i].name + " reading invalid");
        hardwareSensors[i].isWorking = false;
        hardwareSensors[i].errorMessage = "Invalid readings";
      }
    }
  }
  
  // Update global warning status
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
  doc["emergencyShutdown"] = emergencyShutdown;
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
  for (int i = 0; i < 5; i++) {
    hardwareSensors[i].isDetected = false;
    hardwareSensors[i].isWorking = false;
    hardwareSensors[i].errorMessage = "";
  }
  
  // Detect DHT22 Sensor
  bool dhtDetected = detectDHTSensor();
  hardwareSensors[0].isDetected = dhtDetected;
  hardwareSensors[0].isWorking = dhtDetected;
  hardwareSensors[1].isDetected = dhtDetected;
  hardwareSensors[1].isWorking = dhtDetected;
  
  // Detect sensor tambahan
  hardwareSensors[2].isDetected = detectThermocouple();
  hardwareSensors[2].isWorking = hardwareSensors[2].isDetected;
  
  hardwareSensors[3].isDetected = detectVibrationSensor();
  hardwareSensors[3].isWorking = hardwareSensors[3].isDetected;
  
  hardwareSensors[4].isDetected = detectPressureSensor();
  hardwareSensors[4].isWorking = hardwareSensors[4].isDetected;
  
  // Summary
  int detectedCount = 0;
  Serial.println("📊 === HARDWARE DETECTION SUMMARY ===");
  for (int i = 0; i < 5; i++) {
    String status = hardwareSensors[i].isDetected ? "✅ AVAILABLE" : "❌ NOT FOUND";
    Serial.println("   " + hardwareSensors[i].name + " (" + hardwareSensors[i].sensorId + "): " + status);
    if (hardwareSensors[i].isDetected) detectedCount++;
  }
  
  Serial.println("🎯 Total detected sensors: " + String(detectedCount) + "/5");
  
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
  doc["emergencyShutdown"] = emergencyShutdown;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  JsonArray hardwareArray = doc.createNestedArray("hardware");
  
  for (int i = 0; i < 5; i++) {
    JsonObject hw = hardwareArray.createNestedObject();
    hw["name"] = hardwareSensors[i].name;
    hw["sensorId"] = hardwareSensors[i].sensorId;
    hw["type"] = hardwareSensors[i].type;
    hw["pin"] = hardwareSensors[i].pin;
    hw["detected"] = hardwareSensors[i].isDetected;
    hw["working"] = hardwareSensors[i].isWorking;
    hw["error"] = hardwareSensors[i].errorMessage;
    hw["thresholdIndex"] = hardwareSensors[i].thresholdIndex;
    hw["lastValue"] = hardwareSensors[i].lastValue;
  }
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/hardware";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("🔧 Hardware status sent | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Emergency: " + String(emergencyShutdown ? "YES" : "NO") +
                " | Global Status: " + getStatusText(globalWarningStatus));
}

// ---------------- MQTT CALLBACK ----------------
void callback(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';
  String message = String((char*)payload);
  
  Serial.println("=== MQTT MESSAGE RECEIVED ===");
  Serial.println("Topic: " + String(topic));
  Serial.println("Message: " + message);
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
      
      if (action == "startRental") {
        if (systemReady) {
          isStarted = true;
          emergencyShutdown = false; // Reset emergency status
          setRelay(true);
          setBuzzer(false);
          
          Serial.println("🚀 === RENTAL STARTED ===");
          Serial.println("📋 Rental ID: " + rentalId);
          Serial.println("🏭 Machine ID: " + machineId);
          Serial.println("🔌 Relay: ON ⚡");
          Serial.println("🔇 Buzzer: OFF");
          
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
        emergencyShutdown = false; // Reset emergency status
        setRelay(false);
        setBuzzer(false);
        
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
          emergencyShutdown = false;
          setRelay(false);
          setBuzzer(false);
          Serial.println("🛑 === RENTAL STOPPED via command JSON ===");
          sendRentalReport(true, "Rental stopped via command - Relay OFF");
        }
        else if (action == "reset_emergency") {
          emergencyShutdown = false;
          Serial.println("🔄 Emergency Shutdown Reset via command");
          sendRentalReport(true, "Emergency shutdown reset");
        }
      }
    } 
    if (message == "start") {
      if (systemReady) {
        isStarted = true;
        emergencyShutdown = false;
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
      emergencyShutdown = false;
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
    } else if (message == "reset_emergency") {
      emergencyShutdown = false;
      Serial.println("🔄 Emergency Shutdown Reset");
      sendRentalReport(true, "Emergency shutdown reset");
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
  doc["emergencyShutdown"] = emergencyShutdown;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/report";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("📊 Rental report sent: " + message + " | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Emergency: " + String(emergencyShutdown ? "YES" : "NO") +
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
  doc["emergencyShutdown"] = emergencyShutdown;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/connection";
  client.publish(topic.c_str(), buffer, true);
  
  Serial.println("📡 Connection status sent: " + String(connected ? "ONLINE" : "OFFLINE") + 
                " | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Emergency: " + String(emergencyShutdown ? "YES" : "NO") +
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
  doc["emergencyShutdown"] = emergencyShutdown;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/heartbeat";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("💓 Heartbeat sent | Relay: " + String(relayState ? "ON" : "OFF") + 
                " | Emergency: " + String(emergencyShutdown ? "YES" : "NO") +
                " | Global Status: " + getStatusText(globalWarningStatus));
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("🚀 === ESP32 MULTI-SENSOR + RELAY + BUZZER CONTROL ===");
  
  // Setup DHT22
  dht.begin();
  pinMode(DHT_PIN, INPUT);
  
  // Setup Relay
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);
  
  // Setup Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  setBuzzer(false);
  
  // Setup sensor tambahan (Analog pins)
  pinMode(THERMOCOUPLE_PIN, INPUT);
  pinMode(VIBRATION_PIN, INPUT);
  pinMode(PRESSURE_PIN, INPUT);
  
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
  Serial.println("Detecting all sensors...");
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
  Serial.println("🚨 Auto-shutdown: ENABLED for temperature sensors");
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