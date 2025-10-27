#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <max6675.h>

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

// ---------------- PIN CONFIGURATION ----------------
// DHT22
#define DHT_PIN 18
#define DHT_TYPE DHT22

// Thermocouple Type K (MAX6675)
#define THERMO_SO 19    // MISO
#define THERMO_CS 5     // CS
#define THERMO_SCK 18   // SCK

// MPU6050 (I2C)
#define MPU_SDA 21      // I2C SDA
#define MPU_SCL 22      // I2C SCL

// Pressure Transmitter (Analog)
#define PRESSURE_PIN 34 // ADC1 Channel 6

// Relay & Buzzer
#define RELAY_PIN 23
#define BUZZER_PIN 25

// ---------------- SENSOR OBJECTS ----------------
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_MPU6050 mpu;
MAX6675 thermocouple(THERMO_SCK, THERMO_CS, THERMO_SO);

// ---------------- THRESHOLD STANDARDS ----------------
struct ThresholdStandard {
  float normal;
  float caution;
  float warning;
  float critical;
  String unit;
};

// Threshold untuk berbagai tipe sensor
ThresholdStandard thresholds[] = {
  {800, 900, 925, 950, "°C"},      // thermocouple (oven-hardening)
  {1.0, 2.5, 3.5, 4.5, "mm/s"},    // mpu6050 (getaran)
  {5.0, 6.5, 7.5, 8.0, "bar"},     // pressure (pneumatic)
  {50, 70, 80, 90, "°C"},          // dht22 (suhu normal)
};

// ---------------- SENSOR HARDWARE STRUCTURE ----------------
enum SensorType {
  SENSOR_NONE,
  SENSOR_DHT22,
  SENSOR_THERMOCOUPLE,
  SENSOR_MPU6050,
  SENSOR_PRESSURE
};

struct SensorHardware {
  String name;
  String sensorId;
  SensorType type;
  bool isDetected;
  bool isWorking;
  String errorMessage;
  int thresholdIndex;
};

// ---------------- GLOBAL VARIABLES ----------------
String chipId;
String machineId = "";
String rentalId = "";
String machineType = "";
unsigned long lastSensorSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastHardwareCheck = 0;
unsigned long sensorInterval = 5000;
unsigned long heartbeatInterval = 30000;
unsigned long hardwareCheckInterval = 60000;
bool isStarted = false;
bool mqttConnected = false;
bool systemReady = false;
bool relayState = false;
String currentAlertLevel = "normal";
bool buzzerState = false;

// Array untuk menyimpan sensor yang terdeteksi
SensorHardware detectedSensors[10];
int sensorCount = 0;

// ---------------- FUNGSI CONTROL BUZZER ----------------
void setBuzzer(bool state) {
  buzzerState = state;
  if (state) {
    for (int i = 0; i < 3; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
      delay(100);
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

// ---------------- FUNGSI CEK THRESHOLD ----------------
String checkThreshold(float value, ThresholdStandard threshold) {
  if (value >= threshold.critical) {
    return "critical";
  } else if (value >= threshold.warning) {
    return "warning";
  } else if (value >= threshold.caution) {
    return "caution";
  } else {
    return "normal";
  }
}

// ---------------- FUNGSI HANDLE ALERT ----------------
void handleAlert(String alertLevel) {
  if (alertLevel != currentAlertLevel) {
    currentAlertLevel = alertLevel;
    
    Serial.println("⚠️  ALERT LEVEL: " + alertLevel);
    
    if (alertLevel == "caution" || alertLevel == "warning" || alertLevel == "critical") {
      setBuzzer(true);
    } else {
      setBuzzer(false);
    }
    
    sendAlertStatus(alertLevel);
  }
}

// ---------------- FUNGSI KIRIM ALERT STATUS ----------------
void sendAlertStatus(String alertLevel) {
  if (!mqttConnected) return;
  
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["alertLevel"] = alertLevel;
  doc["buzzerActive"] = buzzerState;
  doc["timestamp"] = millis();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/alert";
  client.publish(topic.c_str(), buffer, 0);
}

// ---------------- FUNGSI CONTROL RELAY ----------------
void setRelay(bool state) {
  relayState = state;
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
  Serial.println("🔌 Relay: " + String(state ? "ON ⚡" : "OFF ⭕"));
  
  if (mqttConnected) {
    sendRelayStatus();
  }
}

void sendRelayStatus() {
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["machineId"] = machineId;
  doc["relayState"] = relayState;
  doc["timestamp"] = millis();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/relay";
  client.publish(topic.c_str(), buffer, 0);
}

// ============================================================
// ============ AUTO DETECT HARDWARE SENSORS ==================
// ============================================================

bool detectDHT22() {
  Serial.print("🔍 Detecting DHT22... ");
  
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  delay(2000);
  float temp2 = dht.readTemperature();
  float hum2 = dht.readHumidity();
  
  if (!isnan(temp) && !isnan(hum) && !isnan(temp2) && !isnan(hum2)) {
    if (temp > -50 && temp < 80 && hum >= 0 && hum <= 100) {
      Serial.println("✅ DETECTED (" + String(temp, 1) + "°C, " + String(hum, 1) + "%)");
      return true;
    }
  }
  
  Serial.println("❌ NOT FOUND");
  return false;
}

bool detectThermocouple() {
  Serial.print("🔍 Detecting Thermocouple Type K... ");
  
  delay(500);
  float temp1 = thermocouple.readCelsius();
  delay(500);
  float temp2 = thermocouple.readCelsius();
  
  // MAX6675 returns 0 jika tidak terhubung, atau nilai sangat besar jika error
  if (temp1 > 0 && temp1 < 1100 && temp2 > 0 && temp2 < 1100) {
    if (abs(temp1 - temp2) < 50) {  // Perbedaan wajar
      Serial.println("✅ DETECTED (" + String(temp1, 1) + "°C)");
      return true;
    }
  }
  
  Serial.println("❌ NOT FOUND");
  return false;
}

bool detectMPU6050() {
  Serial.print("🔍 Detecting MPU6050... ");
  
  if (mpu.begin()) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    
    delay(100);
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    
    // Check if values are reasonable
    if (abs(a.acceleration.x) < 20 && abs(a.acceleration.y) < 20 && abs(a.acceleration.z) < 20) {
      Serial.println("✅ DETECTED (Accel: " + String(a.acceleration.x, 2) + " m/s²)");
      return true;
    }
  }
  
  Serial.println("❌ NOT FOUND");
  return false;
}

bool detectPressure() {
  Serial.print("🔍 Detecting Pressure Transmitter... ");
  
  int raw1 = analogRead(PRESSURE_PIN);
  delay(100);
  int raw2 = analogRead(PRESSURE_PIN);
  delay(100);
  int raw3 = analogRead(PRESSURE_PIN);
  
  // Check if analog values are reasonable (not 0 and not max)
  if (raw1 > 100 && raw1 < 4000 && raw2 > 100 && raw2 < 4000) {
    float voltage = (raw1 / 4095.0) * 3.3;
    Serial.println("✅ DETECTED (Raw: " + String(raw1) + ", V: " + String(voltage, 2) + "V)");
    return true;
  }
  
  Serial.println("❌ NOT FOUND");
  return false;
}

// ============================================================
// ============ DETECT ALL HARDWARE ===========================
// ============================================================

void detectAllHardware() {
  Serial.println("\n🔍 === AUTO DETECTING HARDWARE SENSORS ===");
  
  sensorCount = 0;
  
  // 1. Detect DHT22 (Suhu & Kelembaban)
  if (detectDHT22()) {
    detectedSensors[sensorCount++] = {
      "DHT22 Temperature", "dht22_suhu", SENSOR_DHT22, true, true, "", 3
    };
    detectedSensors[sensorCount++] = {
      "DHT22 Humidity", "dht22_kelembaban", SENSOR_DHT22, true, true, "", 3
    };
  }
  
  // 2. Detect Thermocouple Type K (Suhu Tinggi)
  if (detectThermocouple()) {
    detectedSensors[sensorCount++] = {
      "Thermocouple Type K", "thermocouple_suhu", SENSOR_THERMOCOUPLE, true, true, "", 0
    };
  }
  
  // 3. Detect MPU6050 (Getaran)
  if (detectMPU6050()) {
    detectedSensors[sensorCount++] = {
      "MPU6050 Vibration", "mpu6050_getaran", SENSOR_MPU6050, true, true, "", 1
    };
  }
  
  // 4. Detect Pressure Transmitter
  if (detectPressure()) {
    detectedSensors[sensorCount++] = {
      "Pressure Transmitter", "pressure_tekanan", SENSOR_PRESSURE, true, true, "", 2
    };
  }
  
  // Summary
  Serial.println("\n📊 === DETECTION SUMMARY ===");
  for (int i = 0; i < sensorCount; i++) {
    Serial.println("   ✅ " + detectedSensors[i].name + " → " + detectedSensors[i].sensorId);
  }
  Serial.println("🎯 Total detected: " + String(sensorCount) + " sensors");
  
  systemReady = (sensorCount > 0);
  
  if (systemReady) {
    Serial.println("✅ === SYSTEM READY ===\n");
  } else {
    Serial.println("⚠️  === NO SENSORS DETECTED ===\n");
  }
}

// ============================================================
// ============ READ & SEND SENSOR DATA =======================
// ============================================================

void readAndSendAllSensors() {
  if (!mqttConnected || !isStarted || sensorCount == 0) {
    return;
  }
  
  Serial.println("📡 Reading all detected sensors...");
  
  for (int i = 0; i < sensorCount; i++) {
    if (!detectedSensors[i].isWorking) continue;
    
    SensorHardware sensor = detectedSensors[i];
    
    switch (sensor.type) {
      case SENSOR_DHT22:
        readDHT22Sensor(sensor);
        break;
        
      case SENSOR_THERMOCOUPLE:
        readThermocoupleSensor(sensor);
        break;
        
      case SENSOR_MPU6050:
        readMPU6050Sensor(sensor);
        break;
        
      case SENSOR_PRESSURE:
        readPressureSensor(sensor);
        break;
        
      default:
        break;
    }
  }
}

// ---- READ DHT22 ----
void readDHT22Sensor(SensorHardware sensor) {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  
  if (!isnan(temp) && !isnan(hum)) {
    if (sensor.sensorId == "dht22_suhu") {
      String alert = checkThreshold(temp, thresholds[sensor.thresholdIndex]);
      handleAlert(alert);
      sendSensorData(sensor.sensorId, "suhu", temp, "°C", alert);
    } else {
      sendSensorData(sensor.sensorId, "kelembaban", hum, "%", "normal");
    }
  }
}

// ---- READ THERMOCOUPLE ----
void readThermocoupleSensor(SensorHardware sensor) {
  float temp = thermocouple.readCelsius();
  
  if (temp > 0 && temp < 1100) {
    String alert = checkThreshold(temp, thresholds[sensor.thresholdIndex]);
    handleAlert(alert);
    sendSensorData(sensor.sensorId, "suhu", temp, "°C", alert);
  }
}

// ---- READ MPU6050 ----
void readMPU6050Sensor(SensorHardware sensor) {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  
  // Hitung magnitude getaran (RMS)
  float vibration = sqrt(
    pow(a.acceleration.x, 2) + 
    pow(a.acceleration.y, 2) + 
    pow(a.acceleration.z, 2)
  );
  
  String alert = checkThreshold(vibration, thresholds[sensor.thresholdIndex]);
  handleAlert(alert);
  sendSensorData(sensor.sensorId, "getaran", vibration, "m/s²", alert);
}

// ---- READ PRESSURE ----
void readPressureSensor(SensorHardware sensor) {
  int rawValue = analogRead(PRESSURE_PIN);
  
  // Konversi ADC ke Tekanan (asumsi 0-10 bar untuk 0-3.3V)
  float voltage = (rawValue / 4095.0) * 3.3;
  float pressure = (voltage / 3.3) * 10.0;  // Sesuaikan dengan spesifikasi sensor
  
  String alert = checkThreshold(pressure, thresholds[sensor.thresholdIndex]);
  handleAlert(alert);
  sendSensorData(sensor.sensorId, "tekanan", pressure, "bar", alert);
}

// ============================================================
// ============ SEND SENSOR DATA TO MQTT ======================
// ============================================================

void sendSensorData(String sensorId, String sensorType, float value, String unit, String alertLevel) {
  StaticJsonDocument<300> doc;
  doc["sensorId"] = sensorId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["sensorType"] = sensorType;
  doc["value"] = value;
  doc["unit"] = unit;
  doc["alertLevel"] = alertLevel;
  doc["timestamp"] = millis();
  doc["chipId"] = chipId;
  doc["relayState"] = relayState;
  
  char buffer[300];
  serializeJson(doc, buffer);
  
  String topic = "sensor/" + sensorId + "/data";
  
  if (client.publish(topic.c_str(), buffer, 0)) {
    Serial.println("  ✅ " + sensorType + ": " + String(value, 2) + unit + " [" + alertLevel + "]");
  }
}

// ============================================================
// ============ SEND HARDWARE STATUS ==========================
// ============================================================

void sendHardwareStatus() {
  if (!mqttConnected) return;
  
  StaticJsonDocument<1024> doc;
  doc["chipId"] = chipId;
  doc["timestamp"] = millis();
  doc["systemReady"] = systemReady;
  doc["relayState"] = relayState;
  doc["alertLevel"] = currentAlertLevel;
  
  JsonArray hardwareArray = doc.createNestedArray("hardware");
  
  for (int i = 0; i < sensorCount; i++) {
    JsonObject hw = hardwareArray.createNestedObject();
    hw["name"] = detectedSensors[i].name;
    hw["sensorId"] = detectedSensors[i].sensorId;
    hw["detected"] = detectedSensors[i].isDetected;
    hw["working"] = detectedSensors[i].isWorking;
  }
  
  char buffer[1024];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/hardware";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("🔧 Hardware status sent");
}

// ============================================================
// ============ MQTT CALLBACK =================================
// ============================================================

void callback(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';
  String message = String((char*)payload);
  Serial.printf("🎯 Topic: %s | Message: %s\n", topic, message.c_str());
  
  String topicStr = String(topic);

  if (topicStr.endsWith("/config")) {
    StaticJsonDocument<1024> doc;
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
      String action = doc["action"] | "";
      rentalId = doc["rentalId"] | "";
      machineId = doc["machineId"] | "";
      machineType = doc["machineType"] | "";
      
      if (action == "startRental") {
        if (systemReady) {
          isStarted = true;
          setRelay(true);
          
          Serial.println("🚀 === RENTAL STARTED ===");
          Serial.println("   Rental ID: " + rentalId);
          Serial.println("   Machine ID: " + machineId);
          
          detectAllHardware();
          sendHardwareStatus();
          sendRentalReport(true, "Rental started - Relay ON");
        } else {
          sendRentalReport(false, "No sensors detected");
        }
      }
      else if (action == "endRental" || action == "stopRental") {
        isStarted = false;
        setRelay(false);
        setBuzzer(false);
        currentAlertLevel = "normal";
        
        Serial.println("🛑 === RENTAL ENDED ===");
        sendRentalReport(true, "Rental ended - Relay OFF");
        
        machineId = "";
        rentalId = "";
      }
    }
  }
  
  else if (topicStr.endsWith("/command")) {
    if (message == "start") {
      if (systemReady) {
        isStarted = true;
        setRelay(true);
        sendRentalReport(true, "Machine started");
      }
    } else if (message == "stop") {
      isStarted = false;
      setRelay(false);
      setBuzzer(false);
      sendRentalReport(true, "Machine stopped");
    } else if (message == "detect") {
      detectAllHardware();
      sendHardwareStatus();
    }
  }
}

void sendRentalReport(bool success, String message) {
  if (!mqttConnected) return;
  
  StaticJsonDocument<256> doc;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["chipId"] = chipId;
  doc["status"] = success ? "success" : "error";
  doc["message"] = message;
  doc["timestamp"] = millis();
  doc["isStarted"] = isStarted;
  doc["relayState"] = relayState;
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/report";
  client.publish(topic.c_str(), buffer, 0);
}

// ============================================================
// ============ MQTT RECONNECT ================================
// ============================================================

void reconnect() {
  while (!client.connected()) {
    Serial.print("🔄 Connecting to MQTT...");
    
    String clientId = "ESP32-" + chipId + "-" + String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str(), mqtt_username, mqtt_password)) {
      Serial.println(" ✅ Connected!");
      mqttConnected = true;
      
      String configTopic = "machine/" + chipId + "/config";
      String commandTopic = "machine/" + chipId + "/command";
      
      client.subscribe(configTopic.c_str(), 1);
      client.subscribe(commandTopic.c_str(), 1);
      
      sendConnectionStatus(true);
      sendHardwareStatus();
      
    } else {
      mqttConnected = false;
      Serial.println(" ❌ Failed");
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
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/connection";
  client.publish(topic.c_str(), buffer, true);
}

void sendHeartbeat() {
  if (!mqttConnected) return;
  
  StaticJsonDocument<300> doc;
  doc["chipId"] = chipId;
  doc["timestamp"] = millis();
  doc["uptime"] = millis() / 1000;
  doc["isStarted"] = isStarted;
  doc["relayState"] = relayState;
  doc["alertLevel"] = currentAlertLevel;
  
  char buffer[300];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/heartbeat";
  client.publish(topic.c_str(), buffer, 0);
}

// ============================================================
// ============ SETUP =========================================
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n🚀 === ESP32 DYNAMIC SENSOR SYSTEM ===");
  
  // Init pins
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setRelay(false);
  digitalWrite(BUZZER_PIN, LOW);
  
  // Init sensors
  dht.begin();
  Wire.begin(MPU_SDA, MPU_SCL);
  
  chipId = String((uint32_t)ESP.getEfuseMac(), HEX);
  chipId.toUpperCase();
  Serial.println("🆔 Chip ID: " + chipId);
  
  // WiFi
  Serial.println("📶 Connecting WiFi...");
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi OK: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n❌ WiFi Failed! Restarting...");
    ESP.restart();
  }
  
  // Detect hardware
  delay(2000);
  detectAllHardware();
  
  // MQTT
  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  
  Serial.println("=== SYSTEM READY ===\n");
}

// ============================================================
// ============ LOOP ==========================================
// ============================================================

void loop() {
  client.loop();
  
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(ssid, password);
    delay(5000);
    return;
  }
  
  if (!client.connected()) {
    mqttConnected = false;
    reconnect();
  }
  
  unsigned long now = millis();
  
  if (now - lastHardwareCheck > hardwareCheckInterval) {
    lastHardwareCheck = now;
    detectAllHardware();
    sendHardwareStatus();
  }
  
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