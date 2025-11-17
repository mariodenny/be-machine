#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <max6675.h>
#include <Wire.h>
#include <MPU6050.h>

// ---------------- WIFI CONFIG ----------------
const char* ssid = "Naufal123";
const char* password = "12345678";

// ---------------- HIVEMQ CLOUD CONFIG ----------------
const char* mqtt_server = "5a4b12ea6b7e4a879fcd9b34a94de671.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_username = "esp-be-machine";
const char* mqtt_password = "Be_Machine@123";

WiFiClientSecure espClient;
PubSubClient client(espClient);

// ---------------- RELAY CONFIG ----------------
#define RELAY_PIN 32

// ---------------- BUZZER CONFIG ----------------
#define BUZZER_PIN 33

// ---------------- MAX6675 CONFIG ----------------
#define thermoSO 19
#define thermoCS 5
#define thermoSCK 18
MAX6675 thermocouple(thermoSCK, thermoCS, thermoSO);

// ---------------- PRESSURE SENSOR CONFIG (WPT83G) ----------------
#define PRESSURE_PIN 34
// Konversi ADC ke Bar: 0-10V = 0-10 Bar, ESP32 ADC 0-3.3V
#define PRESSURE_MIN_V 0.5      // 0.5V = 0 Bar
#define PRESSURE_MAX_V 2.5      // 2.5V = 10 Bar
#define ADC_MAX 4095.0

// ---------------- MPU6050 CONFIG ----------------
MPU6050 mpu;
#define MPU6050_ADDR 0x68
// Variabel untuk vibration
float vibrationRMS = 0.0;
float lastVibration = 0.0;

// ---------------- THRESHOLD CONFIG (ISO STANDARD) ----------------
struct ThresholdStandard {
  float normal_min;
  float normal_max;
  float warning_min;
  float warning_max;
  float danger_min;
  float danger_max;
  String unit;
  String sensorType;
  bool autoShutdown;
};

// Threshold berdasarkan standar ISO untuk mesin industri
ThresholdStandard sensorThresholds[] = {
  // Thermocouple (ISO 18436-1 untuk monitoring suhu)
  {15, 70,     // normal: 15-70°C
   10, 75,     // warning: <10 atau >75°C  
   5, 80,      // danger: <5 atau >80°C
   "°C", "thermocouple", true},
  
  // Pressure WPT83G (ISO 1219 untuk sistem hidrolik)
  {2.0, 8.0,   // normal: 2-8 Bar
   1.5, 8.5,   // warning: <1.5 atau >8.5 Bar
   1.0, 9.0,   // danger: <1.0 atau >9.0 Bar
   "Bar", "pressure", false},
  
  // Vibration MPU6050 (ISO 10816 untuk getaran mesin)
  {0, 2.5,     // normal: 0-2.5 mm/s
   2.6, 4.5,   // warning: 2.6-4.5 mm/s
   4.6, 10.0,  // danger: >4.6 mm/s
   "mm/s", "vibration", false}
};

// ---------------- WARNING STATUS ENUM ----------------
enum WarningStatus {
  STATUS_NORMAL,
  STATUS_WARNING,
  STATUS_DANGER,
  STATUS_CRITICAL
};

// ---------------- DANGER TRACKING ----------------
struct DangerTracking {
  String sensorName;
  int consecutiveDangerCount;
  unsigned long firstDangerTime;
  float lastDangerValue;
  bool wasInDanger;
};

DangerTracking dangerTrackers[3] = {
  {"Thermocouple", 0, 0, 0, false},
  {"Pressure Sensor", 0, 0, 0, false},
  {"Vibration Sensor", 0, 0, 0, false}
};

const int DANGER_COUNT_THRESHOLD = 3;
const unsigned long DANGER_TIME_WINDOW = 15000;

// ---------------- STRUKTUR SENSOR ----------------
struct SensorHardware {
  String name;
  String sensorId;
  int pin;   
  bool isDetected;
  bool isWorking;
  String errorMessage;
  int thresholdIndex;
  unsigned long lastCheck;
  float lastValue;
};

// ---------------- GLOBAL VARIABEL ----------------
String chipId;
String machineId = "";
String rentalId = "";
unsigned long lastSensorSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastHardwareCheck = 0;
unsigned long lastBuzzerUpdate = 0;
unsigned long lastVibrationRead = 0;
unsigned long sensorInterval = 5000;
unsigned long heartbeatInterval = 30000;
unsigned long hardwareCheckInterval = 60000;
unsigned long buzzerInterval = 1000;
unsigned long vibrationInterval = 100;
bool isStarted = false;
bool mqttConnected = false;
bool systemReady = false;
bool relayState = false;
bool buzzerState = false;
bool emergencyShutdown = false;
WarningStatus globalWarningStatus = STATUS_NORMAL;

// 3 Sensor: Thermocouple, Pressure, Vibration
SensorHardware hardwareSensors[3] = {
  {"Thermocouple K", "thermocouple_k", thermoCS, false, false, "", 0, 0, 0},
  {"Pressure Sensor", "pressure_sensor", PRESSURE_PIN, false, false, "", 1, 0, 0},
  {"Vibration Sensor", "vibration_sensor", -1, false, false, "", 2, 0, 0} // MPU6050 menggunakan I2C
};

// ---------------- DEBUG HELPER FUNCTIONS ----------------
void printDebug(String category, String message) {
  Serial.println("[" + category + "] " + message);
}

void printError(String category, String message) {
  Serial.println("❌ [" + category + "] " + message);
}

void printSuccess(String category, String message) {
  Serial.println("✅ [" + category + "] " + message);
}

void printWarning(String category, String message) {
  Serial.println("⚠️ [" + category + "] " + message);
}

void printInfo(String category, String message) {
  Serial.println("ℹ️ [" + category + "] " + message);
}

// ---------------- STATUS TEXT HELPERS ----------------
String getStatusText(WarningStatus status) {
  switch (status) {
    case STATUS_NORMAL: return "NORMAL";
    case STATUS_WARNING: return "WARNING";
    case STATUS_DANGER: return "DANGER";
    case STATUS_CRITICAL: return "CRITICAL";
    default: return "UNKNOWN";
  }
}

String getStatusEmoji(WarningStatus status) {
  switch (status) {
    case STATUS_NORMAL: return "✅";
    case STATUS_WARNING: return "⚠️";
    case STATUS_DANGER: return "🚨";
    case STATUS_CRITICAL: return "💀";
    default: return "❓";
  }
}

// ---------------- RELAY CONTROL ----------------
void setRelay(bool state) {
  if (emergencyShutdown && state) {
    printError("RELAY", "Cannot turn ON - Emergency Shutdown Active!");
    return;
  }
  
  relayState = state;
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
  
  printInfo("RELAY", "State: " + String(state ? "ON ⚡" : "OFF ⭕"));
  
  if (!state && emergencyShutdown) {
    emergencyShutdown = false;
    printInfo("RELAY", "Emergency Shutdown Reset");
  }
  
  if (mqttConnected) {
    sendRelayStatus();
  }
}

// ---------------- BUZZER CONTROL ----------------
void setBuzzer(bool state) {
  buzzerState = state;
  digitalWrite(BUZZER_PIN, state ? HIGH : LOW);
  
  if (state) {
    printDebug("BUZZER", "🔊 ON");
  } else {
    printDebug("BUZZER", "🔇 OFF");
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
      if (now - lastBuzzerToggle > 2000) {
        buzzerToggleState = !buzzerToggleState;
        setBuzzer(buzzerToggleState);
        lastBuzzerToggle = now;
      }
      break;
      
    case STATUS_DANGER:
      if (now - lastBuzzerToggle > 1000) {
        buzzerToggleState = !buzzerToggleState;
        setBuzzer(buzzerToggleState);
        lastBuzzerToggle = now;
      }
      break;
      
    case STATUS_CRITICAL:
      setBuzzer(true);
      break;
  }
}

// ---------------- SENSOR READING FUNCTIONS ----------------
float readThermocouple() {
  delay(250); // Beri waktu stabilisasi
  
  float temperature = thermocouple.readCelsius();
  
  // Debug detail
  Serial.print("🎯 THERMOCOUPLE DEBUG: ");
  Serial.print(temperature, 2);
  Serial.print("°C | isNaN: ");
  Serial.println(isnan(temperature));
  
  if (isnan(temperature)) {
    printError("THERMOCOUPLE", "NaN reading detected");
    return 25.0; // Nilai default
  }
  
  if (temperature == 0.0) {
    printInfo("THERMOCOUPLE", "Reading 0°C - Sensor at room temperature");
    return 0.0;
  }
  
  if (temperature < -50.0 || temperature > 1000.0) {
    printWarning("THERMOCOUPLE", "Out of range: " + String(temperature) + "°C");
    return 25.0; // Nilai default
  }
  
  printDebug("THERMOCOUPLE", "Temperature: " + String(temperature, 1) + "°C");
  return temperature;
}

float readPressure() {
  int analogValue = analogRead(PRESSURE_PIN);
  float voltage = analogValue * (3.3 / ADC_MAX);
  
  // Konversi voltage ke pressure (0.5V = 0 Bar, 2.5V = 10 Bar)
  float pressure = 0.0;
  if (voltage >= PRESSURE_MIN_V) {
    pressure = (voltage - PRESSURE_MIN_V) * (10.0 / (PRESSURE_MAX_V - PRESSURE_MIN_V));
  }
  
  // Filter noise untuk nilai sangat kecil
  if (pressure < 0.1) pressure = 0.0;
  
  printDebug("PRESSURE", "Value: " + String(pressure, 2) + " Bar (Voltage: " + String(voltage, 2) + "V, ADC: " + String(analogValue) + ")");
  return pressure;
}

float readVibration() {
  // Baca accelerometer dari MPU6050
  int16_t ax, ay, az;
  mpu.getAcceleration(&ax, &ay, &az);
  
  // Konversi raw values ke g-force
  float ax_g = ax / 16384.0;
  float ay_g = ay / 16384.0;
  float az_g = az / 16384.0;
  
  // Hitung RMS vibration (mm/s)
  // Asumsi: 1g = 9.81 m/s² = 9810 mm/s²
  float vibration_mm_s = sqrt(ax_g*ax_g + ay_g*ay_g + az_g*az_g) * 9810.0;
  
  // Low-pass filter untuk smoothing
  vibrationRMS = 0.7 * vibrationRMS + 0.3 * vibration_mm_s;
  
  printDebug("VIBRATION", "Value: " + String(vibrationRMS, 2) + " mm/s (Raw: " + String(vibration_mm_s, 2) + " mm/s)");
  return vibrationRMS;
}

// ---------------- WARNING STATUS CHECK ----------------
WarningStatus checkWarningStatus(float value, int thresholdIndex) {
  if (thresholdIndex < 0 || thresholdIndex >= 3) return STATUS_NORMAL;
  
  ThresholdStandard threshold = sensorThresholds[thresholdIndex];
  
  // DANGER: nilai keluar dari batas danger_min dan danger_max
  if (value < threshold.danger_min || value > threshold.danger_max) {
    return STATUS_DANGER;
  }
  
  // WARNING: nilai keluar dari warning range tapi masih dalam danger range
  if (value < threshold.warning_min || value > threshold.warning_max) {
    return STATUS_WARNING;
  }
  
  // NORMAL: nilai dalam range normal
  if (value >= threshold.normal_min && value <= threshold.normal_max) {
    return STATUS_NORMAL;
  }
  
  return STATUS_WARNING;
}
// ---------------- AUTO SHUTDOWN DENGAN RESET ----------------
void checkAutoShutdown(float value, int thresholdIndex, String sensorName) {
  if (thresholdIndex < 0 || thresholdIndex >= 3) return;
  
  ThresholdStandard threshold = sensorThresholds[thresholdIndex];
  
  if (!threshold.autoShutdown) return;
  
  bool isDanger = (value < threshold.danger_min || value > threshold.danger_max);
  
  if (isDanger) {
    if (!dangerTrackers[thresholdIndex].wasInDanger) {
      dangerTrackers[thresholdIndex].firstDangerTime = millis();
      dangerTrackers[thresholdIndex].wasInDanger = true;
      printWarning("AUTO-SHUTDOWN", sensorName + " entered DANGER zone!");
    }
    
    dangerTrackers[thresholdIndex].consecutiveDangerCount++;
    dangerTrackers[thresholdIndex].lastDangerValue = value;
    
    unsigned long dangerDuration = millis() - dangerTrackers[thresholdIndex].firstDangerTime;
    
    Serial.println("");
    printWarning("DANGER-TRACKING", "=== DANGER ALERT ===");
    printInfo("SENSOR", sensorName);
    printInfo("VALUE", String(value) + threshold.unit);
    printInfo("RANGE", "Safe: " + String(threshold.danger_min) + "-" + String(threshold.danger_max) + threshold.unit);
    printInfo("COUNT", String(dangerTrackers[thresholdIndex].consecutiveDangerCount) + "/" + String(DANGER_COUNT_THRESHOLD));
    printInfo("DURATION", String(dangerDuration) + "ms / " + String(DANGER_TIME_WINDOW) + "ms");
    Serial.println("");
    
    if (dangerTrackers[thresholdIndex].consecutiveDangerCount >= DANGER_COUNT_THRESHOLD &&
        dangerDuration <= DANGER_TIME_WINDOW &&
        relayState && 
        !emergencyShutdown) {
      
      emergencyShutdown = true;
      setRelay(false);
      
      Serial.println("\n" + String("=").substring(0, 60));
      printError("EMERGENCY", "AUTO-SHUTDOWN ACTIVATED!");
      printInfo("SENSOR", sensorName);
      printInfo("VALUE", String(value) + threshold.unit);
      printInfo("SAFE-RANGE", String(threshold.danger_min) + " - " + String(threshold.danger_max) + threshold.unit);
      printInfo("DANGER-COUNT", String(dangerTrackers[thresholdIndex].consecutiveDangerCount) + " readings");
      printInfo("DURATION", String(dangerDuration) + "ms");
      printInfo("RELAY", "FORCED OFF ⭕");
      printInfo("SYSTEM", "AUTO-RESET IN 10 SECONDS...");
      Serial.println(String("=").substring(0, 60));
      
      sendEmergencyShutdownReport(sensorName, value, threshold.unit);
      
      // ⭐ AUTO RESET SETELAH SHUTDOWN
      startAutoResetCountdown();
      
      dangerTrackers[thresholdIndex].consecutiveDangerCount = 0;
    }
    
  } else {
    if (dangerTrackers[thresholdIndex].wasInDanger) {
      printSuccess("AUTO-SHUTDOWN", sensorName + " returned to safe zone. Counter reset.");
      dangerTrackers[thresholdIndex].consecutiveDangerCount = 0;
      dangerTrackers[thresholdIndex].firstDangerTime = 0;
      dangerTrackers[thresholdIndex].wasInDanger = false;
    }
  }
}

// ---------------- AUTO RESET COUNTDOWN ----------------
void startAutoResetCountdown() {
  unsigned long resetStartTime = millis();
  const unsigned long RESET_DELAY = 10000; // 10 detik
  
  Serial.println("\n🔄 === AUTO RESET COUNTDOWN STARTED ===");
  Serial.println("⏰ ESP32 will reset in 10 seconds...");
  
  while (millis() - resetStartTime < RESET_DELAY) {
    // Countdown display
    unsigned long remaining = (RESET_DELAY - (millis() - resetStartTime)) / 1000;
    
    if (remaining % 2 == 0) { // Blink setiap 2 detik
      setBuzzer(true);
      Serial.println("🚨 RESET IN: " + String(remaining) + " seconds 🚨");
    } else {
      setBuzzer(false);
    }
    
    delay(1000);
  }
  
  // Final warning sebelum reset
  setBuzzer(true);
  Serial.println("\n💀 === SYSTEM RESETTING NOW ===");
  Serial.println("🔁 ESP32 restarting...");
  delay(2000);
  
  // Reset ESP
  ESP.restart();
}

// ---------------- FUNGSI DETEKSI HARDWARE ----------------
bool detectThermocouple() {
  printInfo("DETECT", "Detecting Thermocouple K-Type...");

  int validReadings = 0;
  float totalTemp = 0;
  
  for (int i = 0; i < 5; i++) {
    float temp = readThermocouple();
    if (!isnan(temp) && temp > -10.0 && temp < 500.0) {
      validReadings++;
      totalTemp += temp;
    }
    delay(200);
  }
  
  if (validReadings >= 3) {
    float avgTemp = totalTemp / validReadings;
    printSuccess("DETECT", "Thermocouple DETECTED (Avg: " + String(avgTemp, 1) + "°C, " + String(validReadings) + "/5 valid readings)");
    return true;
  } else {
    printError("DETECT", "Thermocouple NOT DETECTED - Only " + String(validReadings) + "/5 valid readings");
    return false;
  }
}

bool detectPressureSensor() {
  printInfo("DETECT", "Detecting Pressure Sensor WPT83G...");
  
  int validReadings = 0;
  for (int i = 0; i < 3; i++) {
    float press = readPressure();
    if (!isnan(press) && press >= 0 && press <= 10) {
      validReadings++;
    }
    delay(100);
  }
  
  if (validReadings >= 2) {
    printSuccess("DETECT", "Pressure Sensor DETECTED (" + String(validReadings) + "/3 valid readings)");
    return true;
  } else {
    printError("DETECT", "Pressure Sensor NOT DETECTED");
    return false;
  }
}

bool detectVibrationSensor() {
  printInfo("DETECT", "Detecting MPU6050 Vibration Sensor...");
  
  // Test koneksi MPU6050
  if (!mpu.testConnection()) {
    printError("DETECT", "MPU6050 NOT CONNECTED");
    return false;
  }
  
  int validReadings = 0;
  for (int i = 0; i < 3; i++) {
    float vib = readVibration();
    if (!isnan(vib) && vib >= 0 && vib <= 20) {
      validReadings++;
    }
    delay(100);
  }
  
  if (validReadings >= 2) {
    printSuccess("DETECT", "Vibration Sensor DETECTED (" + String(validReadings) + "/3 valid readings)");
    return true;
  } else {
    printError("DETECT", "Vibration Sensor NOT DETECTED");
    return false;
  }
}

// ---------------- RESET DANGER TRACKERS ----------------
void resetAllDangerTrackers() {
  printInfo("SYSTEM", "Resetting all danger trackers...");
  for (int i = 0; i < 3; i++) {
    dangerTrackers[i].consecutiveDangerCount = 0;
    dangerTrackers[i].firstDangerTime = 0;
    dangerTrackers[i].lastDangerValue = 0;
    dangerTrackers[i].wasInDanger = false;
  }
  printSuccess("SYSTEM", "All danger trackers reset!");
}

void detectAllHardware() {
  Serial.println("🔍 === DETECTING HARDWARE SENSORS ===");

  for (int i = 0; i < 3; i++) {
    hardwareSensors[i].isDetected = false;
    hardwareSensors[i].isWorking = false;
    hardwareSensors[i].errorMessage = "";
  }

  hardwareSensors[0].isDetected = detectThermocouple();
  hardwareSensors[0].isWorking = hardwareSensors[0].isDetected;
  
  hardwareSensors[1].isDetected = detectPressureSensor();
  hardwareSensors[1].isWorking = hardwareSensors[1].isDetected;
  
  hardwareSensors[2].isDetected = detectVibrationSensor();
  hardwareSensors[2].isWorking = hardwareSensors[2].isDetected;

  int detectedCount = 0;
  Serial.println("📊 === HARDWARE DETECTION SUMMARY ===");
  for (int i = 0; i < 3; i++) {
    String status = hardwareSensors[i].isDetected ? "✅ AVAILABLE" : "❌ NOT FOUND";
    Serial.println("   " + hardwareSensors[i].name + ": " + status);
    if (hardwareSensors[i].isDetected) detectedCount++;
  }

  Serial.println("🎯 Total detected sensors: " + String(detectedCount) + "/3");
  systemReady = (detectedCount > 0);

  if (systemReady) Serial.println("✅ === SYSTEM READY ===");
  else Serial.println("⚠️ === SYSTEM NOT READY ===");
}

// ---------------- FUNGSI BACA & KIRIM SEMUA SENSOR ----------------
void readAndSendAllSensors() {
  if (!mqttConnected || !isStarted) {
    Serial.println("⚠️ Skip sensor read - not connected or not started");
    return;
  }

  Serial.println("🎯 READING ALL SENSORS...");
  WarningStatus highestStatus = STATUS_NORMAL;

  // Baca Thermocouple
  if (hardwareSensors[0].isWorking) {
    float temperature = readThermocouple();
    
    if (!isnan(temperature)) {
      hardwareSensors[0].lastValue = temperature;
      WarningStatus status = checkWarningStatus(temperature, 0);
      if (status > highestStatus) highestStatus = status;
      checkAutoShutdown(temperature, 0, "Thermocouple");
      sendSensorData("thermocouple_k", "suhu", temperature, "°C", status);
    }
  }

  // Baca Pressure
  if (hardwareSensors[1].isWorking) {
    float pressure = readPressure();
    
    if (!isnan(pressure)) {
      hardwareSensors[1].lastValue = pressure;
      WarningStatus status = checkWarningStatus(pressure, 1);
      if (status > highestStatus) highestStatus = status;
      checkAutoShutdown(pressure, 1, "Pressure Sensor");
      sendSensorData("pressure_sensor", "tekanan", pressure, "Bar", status);
    }
  }

  // Baca Vibration (gunakan nilai yang sudah di-update di loop)
  if (hardwareSensors[2].isWorking) {
    float vibration = vibrationRMS;
    
    if (!isnan(vibration)) {
      hardwareSensors[2].lastValue = vibration;
      WarningStatus status = checkWarningStatus(vibration, 2);
      if (status > highestStatus) highestStatus = status;
      checkAutoShutdown(vibration, 2, "Vibration Sensor");
      sendSensorData("vibration_sensor", "getaran", vibration, "mm/s", status);
    }
  }

  globalWarningStatus = highestStatus;
  Serial.println("📊 Global Status: " + getStatusEmoji(globalWarningStatus) + " " + getStatusText(globalWarningStatus));
}

// ---------------- FUNGSI KIRIM DATA SENSOR ----------------
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

  char buffer[256];
  serializeJson(doc, buffer);

  String topic = "sensor/" + sensorId + "/data";
  if (client.publish(topic.c_str(), buffer, 0)) {
    Serial.println("✅ Sent: " + sensorType + " = " + String(value) + unit + " [" + getStatusEmoji(status) + "]");
  } else {
    Serial.println("❌ Failed to send: " + sensorType);
  }
}

// ---------------- MODIFIKASI FUNGSI LAIN ----------------
void sendEmergencyShutdownReport(String sensorName, float value, String unit) {
  if (!mqttConnected || machineId == "") return;
  
  StaticJsonDocument<512> doc;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["chipId"] = chipId;
  doc["status"] = "emergency";
  doc["message"] = "EMERGENCY SHUTDOWN: " + sensorName + " reached " + String(value) + unit + " - SYSTEM WILL RESET IN 10s";
  doc["timestamp"] = millis();
  doc["sensorName"] = sensorName;
  doc["sensorValue"] = value;
  doc["unit"] = unit;
  doc["relayState"] = false;
  doc["emergencyShutdown"] = true;
  doc["autoReset"] = true;
  doc["resetCountdown"] = 10;
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/emergency";
  
  if (client.publish(topic.c_str(), buffer, 0)) {
    printSuccess("MQTT", "Emergency report sent! Auto-reset activated");
  } else {
    printError("MQTT", "Failed to send emergency report");
  }
}


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
    printDebug("MQTT", "Relay status sent: " + String(relayState ? "ON" : "OFF"));
  } else {
    printError("MQTT", "Failed to send relay status");
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
  
  for (int i = 0; i < 3; i++) {
    JsonObject hw = hardwareArray.createNestedObject();
    hw["name"] = hardwareSensors[i].name;
    hw["sensorId"] = hardwareSensors[i].sensorId;
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
  
  Serial.println("🔧 Hardware status sent");
}

// ---------------- MQTT CALLBACK & FUNGSI LAINNYA (SAMA SEPERTI SEBELUMNYA) ----------------
// [Bagian MQTT Callback, reconnect, sendRentalReport, dll tetap sama]
// ... (salin dari kode sebelumnya)

void callback(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';
  String message = String((char*)payload);
  Serial.printf("🎯 CALLBACK! Topic: %s\n", topic);
  Serial.printf("   Message: %s\n", message.c_str());
  
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
          emergencyShutdown = false;
          resetAllDangerTrackers();
          setRelay(true);
          setBuzzer(false);
          
          Serial.println("🚀 === RENTAL STARTED ===");
          Serial.println("📋 Rental ID: " + rentalId);
          Serial.println("🏭 Machine ID: " + machineId);
          Serial.println("🔌 Relay: ON ⚡");
          Serial.println("🔊 Buzzer: OFF 🔇");
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
        emergencyShutdown = false;
        resetAllDangerTrackers();
        setRelay(false);
        setBuzzer(false);
        
        Serial.println("🛑 === RENTAL STOPPED ===");
        sendRentalReport(true, "Rental stopped successfully - Relay OFF");
        
        machineId = "";
        rentalId = "";
      }
    }
  }
  
  else if (topicStr.endsWith("/command")) {
    Serial.println("🔧 COMMAND MESSAGE RECEIVED!");
    
    if (message == "start") {
      if (systemReady) {
        isStarted = true;
        emergencyShutdown = false;
        resetAllDangerTrackers();
        setRelay(true);
        setBuzzer(false);
        Serial.println("🚀 Machine started");
        sendRentalReport(true, "Machine started via command - Relay ON");
      } else {
        Serial.println("⚠️ Cannot start - no sensors detected!");
        sendRentalReport(false, "Cannot start - system not ready");
      }
    } else if (message == "stop") {
      isStarted = false;
      emergencyShutdown = false;
      resetAllDangerTrackers();
      setRelay(false);
      setBuzzer(false);
      Serial.println("🛑 Machine stopped");
      sendRentalReport(true, "Machine stopped via command - Relay OFF");
    } else if (message == "detect") {
      Serial.println("🔍 Manual hardware detection requested...");
      detectAllHardware();
      sendHardwareStatus();
    } else if (message == "relay_on") {
      setRelay(true);
    } else if (message == "relay_off") {
      setRelay(false);
    } else if (message == "buzzer_test") {
      Serial.println("🔊 Testing buzzer...");
      setBuzzer(true);
      delay(1000);
      setBuzzer(false);
    } else if (message == "reset_emergency") {
      emergencyShutdown = false;
      resetAllDangerTrackers();
      Serial.println("🔄 Emergency shutdown reset");
      sendRentalReport(true, "Emergency shutdown reset");
    }
  }
}

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
  
  Serial.println("📊 Rental report sent: " + message);
}

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
  
  Serial.println("📡 Connection status sent: " + String(connected ? "ONLINE" : "OFFLINE"));
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
  doc["relayState"] = relayState;  // ✅ PERBAIKAN: relayState, bukan relay
  doc["emergencyShutdown"] = emergencyShutdown;
  doc["globalWarningStatus"] = getStatusText(globalWarningStatus);
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/heartbeat";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("💓 Heartbeat sent | Relay: " + String(relayState ? "ON" : "OFF") + " | Status: " + getStatusText(globalWarningStatus));
}
// ============================================================================
// 🚀 SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("🚀 === ESP32 MULTI-SENSOR MONITORING SYSTEM ===");
  
  // Setup I2C untuk MPU6050
  Wire.begin();
  mpu.initialize();
  
  // Setup Relay
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);
  Serial.println("🔌 Relay initialized (OFF)");
  
  // Setup Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  setBuzzer(false);
  Serial.println("🔊 Buzzer initialized (OFF)");
  
  // Setup Pressure Sensor Pin
  pinMode(PRESSURE_PIN, INPUT);
  Serial.println("📊 Pressure sensor initialized");
  
  // Get Chip ID
  chipId = String((uint32_t)ESP.getEfuseMac(), HEX);
  chipId.toUpperCase();
  Serial.println("🆔 Chip ID: " + chipId);

  // Print threshold configuration
  Serial.println("\n📏 THRESHOLD CONFIGURATION (ISO STANDARD):");
  for (int i = 0; i < 3; i++) {
    Serial.println("   " + sensorThresholds[i].sensorType + ":");
    Serial.println("      ✅ NORMAL  : " + String(sensorThresholds[i].normal_min) + " - " + String(sensorThresholds[i].normal_max) + sensorThresholds[i].unit);
    Serial.println("      ⚠️  WARNING : < " + String(sensorThresholds[i].warning_min) + " or > " + String(sensorThresholds[i].warning_max) + sensorThresholds[i].unit);
    Serial.println("      🚨 DANGER  : < " + String(sensorThresholds[i].danger_min) + " or > " + String(sensorThresholds[i].danger_max) + sensorThresholds[i].unit);
  }

  Serial.println("📶 Connecting to WiFi: " + String(ssid));
  WiFi.begin(ssid, password);
  int wifiAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 20) {
    delay(500);
    Serial.print(".");
    wifiAttempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n❌ WiFi failed! Restarting...");
    delay(10000);
    ESP.restart();
  }

  Serial.println("Detecting all sensors...");
  delay(2000);
  detectAllHardware();

  Serial.println("🔌 Setting up MQTT...");
  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);
  client.setSocketTimeout(30);

  Serial.println("=== SYSTEM READY ===");
  Serial.println("💡 Commands: detect, start, stop, relay_on, relay_off, reset_emergency");
}

// ============================================================================
// 🔁 MAIN LOOP
// ============================================================================
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

  // JANGAN baca sensor atau kirim data jika dalam emergency shutdown
  if (emergencyShutdown) {
    // Sistem sedang dalam proses auto-reset
    return;
  }

  unsigned long now = millis();
  
  // Baca vibration lebih sering (karena butuh smoothing)
  if (now - lastVibrationRead > vibrationInterval) {
    lastVibrationRead = now;
    if (hardwareSensors[2].isWorking) {
      readVibration(); // Update vibrationRMS value
    }
  }

  // Periodic hardware check
  if (now - lastHardwareCheck > hardwareCheckInterval) {
    lastHardwareCheck = now;
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

  // Read and send sensor data
  if (isStarted && mqttConnected && now - lastSensorSend > sensorInterval) {
    lastSensorSend = now;
    readAndSendAllSensors();
  }

  // Serial Command Handler
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    
    if (cmd == "status") {
      printSystemStatus();
    } else if (cmd == "detect") {
      detectAllHardware();
    } else if (cmd == "start") {
      if (systemReady) {
        isStarted = true;
        emergencyShutdown = false;
        resetAllDangerTrackers();
        setRelay(true);
        setBuzzer(false);
        Serial.println("🚀 Machine started via serial command");
      }
    } else if (cmd == "stop") {
      isStarted = false;
      setRelay(false);
      setBuzzer(false);
      Serial.println("🛑 Machine stopped via serial command");
    } else if (cmd == "relay_on") {
      setRelay(true);
    } else if (cmd == "relay_off") {
      setRelay(false);
    } else if (cmd == "reset_emergency") {
      emergencyShutdown = false;
      resetAllDangerTrackers();
      Serial.println("🔄 Emergency reset via serial command");
    } else if (cmd == "help") {
      Serial.println("\n💡 Available Commands:");
      Serial.println("   status         - Show system status");
      Serial.println("   detect         - Detect all sensors");
      Serial.println("   start          - Start machine");
      Serial.println("   stop           - Stop machine");
      Serial.println("   relay_on       - Turn relay ON");
      Serial.println("   relay_off      - Turn relay OFF");
      Serial.println("   reset_emergency- Reset emergency shutdown");
      Serial.println("   help           - Show this help");
    }
  }

  delay(100);
}

// ============================================================================
// 📊 PRINT SYSTEM STATUS
// ============================================================================
void printSystemStatus() {
  Serial.println("\n" + String("=").substring(0, 50));
  Serial.println("📊 SYSTEM STATUS");
  Serial.println(String("=").substring(0, 50));
  Serial.println("🆔 Chip ID: " + chipId);
  Serial.println("🏭 Machine ID: " + machineId);
  Serial.println("📋 Rental ID: " + rentalId);
  Serial.println("📶 WiFi: " + WiFi.localIP().toString() + " | RSSI: " + String(WiFi.RSSI()) + "dBm");
  Serial.println("📡 MQTT: " + String(mqttConnected ? "CONNECTED ✅" : "DISCONNECTED ❌"));
  Serial.println("🔧 System: " + String(systemReady ? "READY ✅" : "NOT READY ❌"));
  Serial.println("🚀 Started: " + String(isStarted ? "YES ✅" : "NO ❌"));
  Serial.println("🔌 Relay: " + String(relayState ? "ON ⚡" : "OFF ⭕"));
  Serial.println("🚨 Emergency: " + String(emergencyShutdown ? "ACTIVE 🚨" : "INACTIVE ✅"));
  Serial.println("📊 Global Status: " + getStatusEmoji(globalWarningStatus) + " " + getStatusText(globalWarningStatus));
  
  Serial.println("\n📡 SENSOR STATUS:");
  for (int i = 0; i < 3; i++) {
    if (hardwareSensors[i].isWorking) {
      Serial.print("   " + hardwareSensors[i].name + ": ");
      Serial.print(String(hardwareSensors[i].lastValue, 2));
      Serial.print(sensorThresholds[i].unit);
      
      WarningStatus status = checkWarningStatus(hardwareSensors[i].lastValue, i);
      Serial.println(" [" + getStatusEmoji(status) + " " + getStatusText(status) + "]");
    } else {
      Serial.println("   " + hardwareSensors[i].name + ": ❌ NOT WORKING");
    }
  }
  Serial.println(String("=").substring(0, 50));
}
